import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { chatWireRequest, OutputName } from '../../chat';
import { PROVISIONAL_DEFAULT_PINS } from '../../provisional-pins';
import { HttpGeneratorConfig } from '../../role-config';
import { chatCompletionBody, chatCompletionsUrl } from './chat-completion';

// `docs/adr/0003-model-roles-and-backends.md` § Decision (k): A11 (prompt-prefix reuse) and A12 (thinking suppressed), against a live server:
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

const body = (system: string, question: string) =>
  chatCompletionBody(
    config(),
    chatWireRequest({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: question },
      ],
      output: { name: OutputName.parse('answer'), schema: z.object({ text: z.string() }) },
    }),
  );

const post = async (payload: object): Promise<Response> => {
  const response = await fetch(chatCompletionsUrl(config().endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'error',
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  expect(response.ok, `HTTP ${String(response.status)}`).toBe(true);
  return response;
};

const replyTo = async (payload: object) => Reply.parse(await (await post(payload)).json());

const firstChunkMs = async (payload: object): Promise<number> => {
  const started = performance.now();
  const response = await post({ ...payload, stream: true });
  const reader = response.body?.getReader();
  await reader?.read();
  const elapsed = performance.now() - started;
  await reader?.cancel();
  return elapsed;
};

describe.runIf(env.CRAM_MEASURE === '1')(
  'OpenAI-compatible generator against a live server',
  () => {
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
      'A11: a repeated system prefix reaches its first token sooner',
      async () => {
        await firstChunkMs(body(synthetic(20, 'warm-up'), 'Load the model.'));
        const prefix = synthetic(PREFIX_LINES, 'the fixed prefix');
        const first = await firstChunkMs(body(prefix, 'What is rule 3?'));
        const second = await firstChunkMs(body(prefix, 'What is rule 7?'));
        const { usage } = await replyTo({ ...body(prefix, 'What is rule 9?'), max_tokens: 1 });
        console.info('A11 time to first chunk (ms)', {
          first,
          second,
          promptTokens: usage.prompt_tokens,
        });
        expect(second).toBeLessThan(first);
      },
      5 * CALL_TIMEOUT_MS,
    );
  },
);
