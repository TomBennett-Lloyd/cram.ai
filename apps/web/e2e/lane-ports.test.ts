// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEV_SERVER_BASE_PORT,
  LANE_BLOCK_OFFSET,
  LANE_COUNT,
  laneIdentity,
  lanePort,
  PREVIEW_BASE_PORT,
} from './lane-ports';

const worktrees = [
  '/Users/tom/Documents/Repos/cram.ai/.claude/worktrees/16-web-ask',
  '/Users/tom/Documents/Repos/cram.ai/.claude/worktrees/107-slide-images',
  '/Users/tom/Documents/Repos/cram.ai/.claude/worktrees/109-confirmation',
  '/home/runner/work/cram.ai/cram.ai/.claude/worktrees/16-web-ask',
];
const bases = [PREVIEW_BASE_PORT, DEV_SERVER_BASE_PORT];
const scratch = (): string => mkdtempSync(join(tmpdir(), 'lane-ports-'));

describe('lanePort', () => {
  it('keeps the base port in a main checkout', () => {
    expect(lanePort(PREVIEW_BASE_PORT, null)).toBe(4173);
    expect(lanePort(DEV_SERVER_BASE_PORT, null)).toBe(5173);
  });

  it('derives a stable port from an identity', () => {
    expect(lanePort(PREVIEW_BASE_PORT, '/repos/cumulo/.claude/worktrees/a')).toBe(24_649);
    expect(lanePort(DEV_SERVER_BASE_PORT, '/repos/cumulo/.claude/worktrees/a')).toBe(25_649);
    expect(lanePort(PREVIEW_BASE_PORT, '/repos/cumulo/.claude/worktrees/b')).toBe(24_295);
  });

  it('lands every worktree inside its base port’s block, below the ephemeral range', () => {
    for (const base of bases)
      for (const path of worktrees) {
        const port = lanePort(base, path);
        expect(port).toBeGreaterThanOrEqual(base + LANE_BLOCK_OFFSET);
        expect(port).toBeLessThan(base + LANE_BLOCK_OFFSET + LANE_COUNT);
        expect(port).toBeLessThan(32_768);
      }
  });

  it('gives concurrent worktrees distinct ports', () => {
    const ports = worktrees.map((path) => lanePort(PREVIEW_BASE_PORT, path));
    expect(new Set(ports).size).toBe(worktrees.length);
  });
});

describe('laneIdentity', () => {
  it('reads a .git directory as the main checkout', () => {
    const root = scratch();
    mkdirSync(join(root, '.git'));
    expect(laneIdentity(join(root))).toBeNull();
  });

  it('reads a .git file as a worktree, from any directory below its root', () => {
    const root = scratch();
    writeFileSync(join(root, '.git'), 'gitdir: /elsewhere/.git/worktrees/scratch\n');
    const nested = join(root, 'apps', 'web', 'e2e');
    mkdirSync(nested, { recursive: true });
    expect(laneIdentity(nested)).toBe(root);
  });

  it('reads no .git anywhere above as the main checkout', () => {
    expect(laneIdentity('/')).toBeNull();
  });
});
