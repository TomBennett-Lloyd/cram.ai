import type { EntailmentResult, Verifier } from '@cram/gateway';
import { PROVISIONAL_DEFAULT_PINS } from '@cram/gateway';
import { describe, expect, it } from 'vitest';
import {
  CONTRADICTED,
  ENTAILED,
  fakeGateway,
  generatorRecording,
  generatorReplies,
  NEUTRAL,
  OVER_LENGTH,
  verifierRecording,
} from './fake-gateway-fixture';
import { PROVISIONAL_NLI_THRESHOLDS } from './nli-verdict';
import { verifierRequest } from './prompts/verifier-prompt';
import { type VerifierStrategy, verifyStatement } from './verify';
import type { VerifierInput } from './verifier-input';

const input: VerifierInput = {
  text: 'Workers are male. They build square cells.',
  quotes: ['Worker bees are male.', 'Bees build comb from square cells.'],
};
const premise = 'Worker bees are male.\nBees build comb from square cells.';
const pairs = [
  { premise, hypothesis: 'Workers are male.' },
  { premise, hypothesis: 'They build square cells.' },
];
const nliSays = (...results: EntailmentResult[]) => verifierRecording(pairs, results);
const llmSays = (verdict: string) => generatorReplies(verifierRequest(input), { verdict });

const verify = (strategy: VerifierStrategy, recordings: Parameters<typeof fakeGateway>[0]) =>
  verifyStatement(input, {
    gateway: fakeGateway(recordings),
    strategy,
    thresholds: PROVISIONAL_NLI_THRESHOLDS,
  });

const verdict = (v: string) => ({ status: 'verified', verdict: v });

describe('verifyStatement, nli', () => {
  it('judges each claim against the union of the quotes and maps the scores', async () => {
    await expect(verify('nli', [nliSays(ENTAILED, ENTAILED)])).resolves.toEqual(
      verdict('supported'),
    );
    await expect(verify('nli', [nliSays(ENTAILED, NEUTRAL)])).resolves.toEqual(verdict('partial'));
    await expect(verify('nli', [nliSays(ENTAILED, CONTRADICTED)])).resolves.toEqual(
      verdict('unsupported'),
    );
  });

  it('fails an over-length input closed, never truncating it and asking no second opinion', async () => {
    await expect(verify('nli', [nliSays(ENTAILED, OVER_LENGTH)])).resolves.toEqual(
      verdict('unsupported'),
    );
  });

  it('refuses a verifier that returns a result count other than one per claim', async () => {
    const short: Verifier = {
      pin: PROVISIONAL_DEFAULT_PINS.verifier,
      entail: () => Promise.resolve([ENTAILED]),
    };
    const gateway = { generator: fakeGateway([]).generator, verifier: short };
    await expect(
      verifyStatement(input, { gateway, strategy: 'nli', thresholds: PROVISIONAL_NLI_THRESHOLDS }),
    ).rejects.toThrow('verifier returned 1 results for 2 pairs');
  });
});

describe('verifyStatement, nli-then-llm', () => {
  it('asks the LLM path for a second opinion on partial, and returns its verdict', async () => {
    await expect(
      verify('nli-then-llm', [nliSays(ENTAILED, NEUTRAL), llmSays('supported')]),
    ).resolves.toEqual(verdict('supported'));
  });

  it('sends an over-length input to the LLM path', async () => {
    await expect(
      verify('nli-then-llm', [nliSays(OVER_LENGTH, ENTAILED), llmSays('partial')]),
    ).resolves.toEqual(verdict('partial'));
  });

  it.each([
    ['supported', [ENTAILED, ENTAILED]],
    ['unsupported', [NEUTRAL, NEUTRAL]],
  ] as const)('keeps a %s NLI verdict without asking the LLM path', async (expected, results) => {
    await expect(verify('nli-then-llm', [nliSays(...results)])).resolves.toEqual(verdict(expected));
  });
});

describe('verifyStatement, llm', () => {
  it('returns the LLM path’s verdict without calling the cross-encoder', async () => {
    await expect(verify('llm', [llmSays('partial')])).resolves.toEqual(verdict('partial'));
  });

  it('reports a backend failure as a value', async () => {
    const reply = { status: 'backend-failed', reason: 'timeout' } as const;
    await expect(
      verify('llm', [generatorRecording(verifierRequest(input), reply)]),
    ).resolves.toEqual({ status: 'model-failed', failure: reply });
  });

  it('reports a reply outside the verdict vocabulary as a value', async () => {
    await expect(verify('llm', [llmSays('true')])).resolves.toMatchObject({
      status: 'model-failed',
      failure: { status: 'invalid-output' },
    });
  });
});
