import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { chatWireRequest } from '../../chat';
import { PROVISIONAL_DEFAULT_PINS } from '../../provisional-pins';
import { HttpGeneratorConfig } from '../../role-config';
import { chatCompletionBody, chatCompletionsUrl } from './chat-completion';

// `docs/adr/0003-model-roles-and-backends.md` § Decision (k): A11 (prompt-prefix reuse) and A12 (thinking suppressed), against a live server:
// CRAM_MEASURE=1 CRAM_GENERATOR_ENDPOINT=http://127.0.0.1:11434/v1/ CRAM_GENERATOR_MODEL=<served name> \
//   pnpm --filter @cram/gateway exec vitest run src/adapters/openai-http/openai-http.measure.test.ts --silent=false
const env = process.env;

const Usage = z.object({
  choices: z.tuple([z.object({ message: z.object({ reasoning: z.string().optional() }) })]),
  usage: z.object({ completion_tokens: z.number() }),
});

const config = (): HttpGeneratorConfig =>
  HttpGeneratorConfig.parse({
    pin: PROVISIONAL_DEFAULT_PINS.generator,
    endpoint: env.CRAM_GENERATOR_ENDPOINT,
    servedModel: env.CRAM_GENERATOR_MODEL,
    timeoutMs: 600_000,
    sampling: { temperature: 0, seed: 0 },
  });

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
      output: { name: 'answer', schema: z.object({ text: z.string() }) },
    }),
  );

const post = (payload: object): Promise<Response> =>
  fetch(chatCompletionsUrl(config().endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

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
    it('A12: reasoning_effort none leaves no thinking output', async () => {
      const suppressed = body('Answer briefly.', 'Name one colour.');
      const thinking = { ...suppressed, reasoning_effort: undefined };
      const off = Usage.parse(await (await post(suppressed)).json());
      const on = Usage.parse(await (await post(thinking)).json());
      console.info('A12 completion tokens', {
        suppressed: off.usage.completion_tokens,
        default: on.usage.completion_tokens,
      });
      expect(off.choices[0].message.reasoning ?? '').toBe('');
    });

    it('A11: a repeated system prefix reaches its first token sooner', async () => {
      await firstChunkMs(body(synthetic(20, 'warm-up'), 'Load the model.'));
      const prefix = synthetic(400, 'the fixed prefix');
      const first = await firstChunkMs(body(prefix, 'What is rule 3?'));
      const second = await firstChunkMs(body(prefix, 'What is rule 7?'));
      console.info('A11 time to first chunk (ms)', { first, second });
    });
  },
);
