import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Ports per checkout, so two worktrees can serve at once (ported from cumulo's
 * `apps/web/e2e/lane-ports.ts`). The main checkout keeps Vite's own ports; a
 * worktree takes a lane hashed from its path, a block clear of them.
 */
export const LANE_COUNT = 512;
export const LANE_BLOCK_OFFSET = 20_000;
export const PREVIEW_BASE_PORT = 4173;
export const DEV_SERVER_BASE_PORT = 5173;

const laneOf = (identity: string): number =>
  createHash('sha256').update(identity).digest().readUInt32BE(0) % LANE_COUNT;

const gitEntryKind = (path: string): 'directory' | 'file' | 'absent' => {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (stats === undefined) return 'absent';
  return stats.isDirectory() ? 'directory' : 'file';
};

/** The worktree root above `fromDir`, or `null` in a main checkout (whose `.git` is a directory). */
export const laneIdentity = (fromDir: string): string | null => {
  let candidate = resolve(fromDir);
  for (;;) {
    switch (gitEntryKind(join(candidate, '.git'))) {
      case 'directory':
        return null;
      case 'file':
        return candidate;
      case 'absent':
        break;
    }
    const parent = dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
};

export const lanePort = (basePort: number, identity: string | null): number =>
  identity === null ? basePort : basePort + LANE_BLOCK_OFFSET + laneOf(identity);

const CHECKOUT_IDENTITY = laneIdentity(fileURLToPath(new URL('.', import.meta.url)));

export const PREVIEW_PORT = lanePort(PREVIEW_BASE_PORT, CHECKOUT_IDENTITY);
export const DEV_SERVER_PORT = lanePort(DEV_SERVER_BASE_PORT, CHECKOUT_IDENTITY);
