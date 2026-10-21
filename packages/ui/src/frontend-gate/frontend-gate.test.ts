/**
 * The frontend gate's committed cases: every guard in stylelint.config.mjs, and
 * in eslint.config.mjs's frontend-gate block, has a line in a probe beside this
 * file (#258). The probes are `.txt` so `lint:css` and `lint:js` never read
 * them; each is linted here under a virtual path, so `overrides` and `files`
 * scoping run exactly as they would for a real file at that path.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
// Type-aware linting makes the first ESLint run slow; no case here is near it.
const SLOW = { timeout: 60_000 };

const readProbe = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8');

const sorted = (keys: Iterable<string>): string[] =>
  [...new Set(keys)].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

/** `<line>:<rule>` for each rule a probe line lists after its refused-by marker. */
const expectedRefusals = (text: string): string[] => {
  const keys = text.split('\n').flatMap((line, index) => {
    const rules = /refused-by:([^*]+)/.exec(line)?.[1];
    return rules === undefined
      ? []
      : rules
          .trim()
          .split(/\s+/)
          .map((rule) => `${String(index + 1)}:${rule}`);
  });
  // A probe that lost its markers would otherwise pass by refusing nothing.
  expect(keys).not.toEqual([]);
  return sorted(keys);
};

const stylelintRefusals = async (text: string, virtualPath: string): Promise<string[]> => {
  const { results } = await stylelint.lint({
    code: text,
    codeFilename: join(ROOT, virtualPath),
    configFile: join(ROOT, 'stylelint.config.mjs'),
  });
  const [result] = results;
  if (result === undefined) throw new Error(`stylelint returned no result for ${virtualPath}`);
  expect(result.invalidOptionWarnings).toEqual([]);
  expect(result.parseErrors).toEqual([]);
  return sorted(result.warnings.map((warning) => `${String(warning.line)}:${warning.rule}`));
};

const ESLINT_PATHS = {
  appTs: 'apps/web/src/__gate_probe__.ts',
  appTsx: 'apps/web/src/__gate_probe__.tsx',
  uiTs: 'packages/ui/src/__gate_probe__.ts',
  uiTsx: 'packages/ui/src/__gate_probe__.tsx',
  sharedTs: 'packages/shared/src/__gate_probe__.ts',
} as const;

// The one override: the type-aware presets need a project for a file that is
// not on disk. The gate's rule is syntax-only, so none of its settings moves.
const eslint = new ESLint({
  cwd: ROOT,
  overrideConfig: {
    languageOptions: {
      parserOptions: { projectService: { allowDefaultProject: Object.values(ESLINT_PATHS) } },
    },
  },
});
const GATE_RULE = 'no-restricted-syntax';

const eslintRefusals = async (text: string, virtualPath: string): Promise<string[]> => {
  const [result] = await eslint.lintText(text, { filePath: join(ROOT, virtualPath) });
  if (result === undefined) throw new Error(`eslint returned no result for ${virtualPath}`);
  // A parse error or an ignored-file notice carries no rule id.
  expect(result.messages.filter((message) => message.ruleId === null)).toEqual([]);
  return sorted(
    result.messages
      .filter((message) => message.ruleId === GATE_RULE)
      .map((message) => `${String(message.line)}:${GATE_RULE}`),
  );
};

describe('stylelint.config.mjs', () => {
  const values = readProbe('values.probe.css.txt');

  // A tokens/ directory outside packages/ui is not the exempt one.
  it.each([
    'apps/web/src/__gate_probe__.css',
    'apps/web/src/tokens/__gate_probe__.css',
    'packages/ui/src/__gate_probe__.css',
  ])('refuses exactly the raw values the values probe marks, at %s', async (virtualPath) => {
    expect(await stylelintRefusals(values, virtualPath)).toEqual(expectedRefusals(values));
  });

  it('exempts tokens/ from the raw-value rules and not from the :focus ban', async () => {
    const tokens = readProbe('tokens-exemption.probe.css.txt');
    expect(await stylelintRefusals(tokens, 'packages/ui/src/tokens/__gate_probe__.css')).toEqual(
      expectedRefusals(tokens),
    );
  });

  it('reports every suppression shape the config’s table names', async () => {
    const suppressions = readProbe('suppressions.probe.css.txt');
    expect(await stylelintRefusals(suppressions, 'apps/web/src/__gate_probe__.css')).toEqual(
      expectedRefusals(suppressions),
    );
  });
});

describe('eslint.config.mjs frontend gate', () => {
  const colour = readProbe('colour.probe.ts.txt');
  const jsx = readProbe('jsx.probe.tsx.txt');

  it.each([ESLINT_PATHS.appTs, ESLINT_PATHS.uiTs])(
    'refuses exactly the colour literals the probe marks, at %s',
    SLOW,
    async (virtualPath) => {
      expect(await eslintRefusals(colour, virtualPath)).toEqual(expectedRefusals(colour));
    },
  );

  it.each([ESLINT_PATHS.appTsx, ESLINT_PATHS.uiTsx])(
    'refuses exactly the JSX colours and inline styles the probe marks, at %s',
    SLOW,
    async (virtualPath) => {
      expect(await eslintRefusals(jsx, virtualPath)).toEqual(expectedRefusals(jsx));
    },
  );

  it('does not reach a package outside apps/ and packages/ui', SLOW, async () => {
    expectedRefusals(colour);
    expect(await eslintRefusals(colour, ESLINT_PATHS.sharedTs)).toEqual([]);
  });
});
