import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { chatWireRequest, OutputName } from '../../chat';
import { decodeTokensPerSecond } from '../../generator-timing';
import { PROVISIONAL_DEFAULT_PINS } from '../../provisional-pins';
import { HttpGeneratorConfig } from '../../role-config';
import { chatCompletionBody, chatCompletionsUrl } from './chat-completion';
import { checkServedModel, loadOpenAiHttpGenerator } from './openai-http-generator';

// `docs/adr/0003-model-roles-and-backends.md` § Decision (k): A4's two figures on this machine, A11 (prompt-prefix reuse)
// and A12 (thinking suppressed), against a live server:
// CRAM_MEASURE=1 CRAM_GENERATOR_ENDPOINT=http://127.0.0.1:11434/v1/ CRAM_GENERATOR_MODEL=<served name> \
//   pnpm --filter @cram/gateway exec vitest run src/adapters/openai-http/openai-http.measure.test.ts --silent=false
const env = process.env;
const CALL_TIMEOUT_MS = 600_000;

const Reply = z.object({
  choices: z.tuple([z.object({ message: z.object({ reasoning: z.string().optional() }) })]),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }),
});

const config = (): HttpGeneratorConfig =>
  HttpGeneratorConfig.parse({
    pin: PROVISIONAL_DEFAULT_PINS.generator,
    endpoint: env.CRAM_GENERATOR_ENDPOINT,
    servedModel: env.CRAM_GENERATOR_MODEL,
    timeoutMs: CALL_TIMEOUT_MS,
    sampling: { temperature: 0, seed: 0 },
  });

// Sized to stay inside Ollama's default context, which silently trims a longer prompt.
const PREFIX_LINES = 150;
const synthetic = (lines: number, topic: string): string =>
  Array.from({ length: lines }, (_, n) => `Rule ${String(n)} of ${topic}: reply in JSON.`).join(
    '\n',
  );

const wire = (system: string, question: string) =>
  chatWireRequest({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: question },
    ],
    output: { name: OutputName.parse('answer'), schema: z.object({ text: z.string() }) },
  });

/** Unstreamed, so the reply carries `reasoning` whole. */
const body = (system: string, question: string) => ({
  ...chatCompletionBody(config(), wire(system, question)),
  stream: false,
  stream_options: undefined,
});

const replyTo = async (payload: object) => {
  const response = await fetch(chatCompletionsUrl(config().endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'error',
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  expect(response.ok, `HTTP ${String(response.status)}`).toBe(true);
  return Reply.parse(await response.json());
};

const timed = async (system: string, question: string) => {
  const load = await loadOpenAiHttpGenerator(config());
  if (load.status !== 'loaded') throw new Error(load.detail);
  const { reply, timing } = await load.generator.timedReply(wire(system, question));
  if (timing === null) throw new Error(`no content token arrived: ${JSON.stringify(reply)}`);
  return timing;
};

describe.runIf(env.CRAM_MEASURE === '1')(
  'OpenAI-compatible generator against a live server',
  () => {
    it('#171: the server serves the pin’s weights', async () => {
      await expect(checkServedModel(config())).resolves.toEqual({ status: 'verified' });
    });

    it(
      'A12: reasoning_effort none leaves no thinking output where the default thinks',
      async () => {
        const suppressed = body('Answer briefly.', 'Name one colour.');
        const off = await replyTo(suppressed);
        const on = await replyTo({ ...suppressed, reasoning_effort: undefined });
        console.info('A12 completion tokens', {
          suppressed: off.usage.completion_tokens,
          default: on.usage.completion_tokens,
        });
        expect(
          on.choices[0].message.reasoning ?? '',
          'positive control: the default thinks',
        ).not.toBe('');
        expect(off.choices[0].message.reasoning ?? '').toBe('');
      },
      3 * CALL_TIMEOUT_MS,
    );

    it(
      'A11: a repeated system prefix reaches its first token sooner; A4: both figures logged',
      async () => {
        await timed(synthetic(20, 'warm-up'), 'Load the model.');
        const prefix = synthetic(PREFIX_LINES, 'the fixed prefix');
        const first = await timed(prefix, 'What is rule 3?');
        const second = await timed(prefix, 'What is rule 7?');
        console.info('A11 and A4 (ms from request start; tokens per second after the first)', {
          first: { ...first, tokensPerSecond: decodeTokensPerSecond(first) },
          second: { ...second, tokensPerSecond: decodeTokensPerSecond(second) },
        });
        expect(second.firstTokenMs).toBeLessThan(first.firstTokenMs);
      },
      4 * CALL_TIMEOUT_MS,
    );
  },
);
