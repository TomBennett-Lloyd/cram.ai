import type { ChatWireRequest, GeneratorReply } from '@cram/gateway';
import { z } from 'zod';
import type { Respond } from './scripted-gateway-fixture';

const KindsBlock = z.strictObject({
  premises: z.array(z.string()),
  sentences: z.array(z.strictObject({ number: z.number(), text: z.string() })),
});

export const PassageBlock = z.strictObject({ lecture: z.string(), passage: z.string() });

const StatementBlock = z.strictObject({ quotes: z.array(z.string()), statement: z.string() });

const words = (text: string): readonly string[] => text.toLowerCase().match(/[a-z]{5,}/g) ?? [];

const content = (value: unknown): GeneratorReply => ({
  status: 'content',
  content: JSON.stringify(value),
});

interface Source {
  readonly id: string;
  readonly line: string;
  readonly text: string;
}

/** The line a scripted unit cites: the second shown, the first after the title. */
const CITED_LINE = 2;

const sourcesOf = (prompt: string): readonly Source[] =>
  [...prompt.matchAll(/<source id="([^"]+)">\n([\s\S]*?)\n<\/source>/g)].map(([, id, text]) => ({
    id: id ?? '',
    text: text ?? '',
    line: (text ?? '').split('\n')[CITED_LINE - 1]?.replace(/^\[\d+\] /, '') ?? '',
  }));

/** Answers from each source sharing a long word with the question, or from every source when `eager`. */
export const tutor =
  (eager: boolean): Respond =>
  (wire: ChatWireRequest) => {
    const prompt = wire.messages.at(-1)?.content ?? '';
    switch (wire.output.name) {
      case 'explanation': {
        const asked = words(/<question>(.*)<\/question>/.exec(prompt)?.[1] ?? '');
        const from = sourcesOf(prompt).filter(
          ({ text }) => eager || words(text).some((word) => asked.includes(word)),
        );
        return content({
          answer:
            from.length === 0
              ? null
              : {
                  text: from.map(({ line }) => line).join(' '),
                  quotes: from.map(({ id }) => ({ sourceId: id, line: CITED_LINE })),
                },
        });
      }
      case 'units': {
        const units = sourcesOf(prompt).map(({ id, line }) => ({
          text: line,
          citations: [{ sourceId: id, line: CITED_LINE }],
        }));
        return content({ units });
      }
      case 'verdict': {
        const { quotes, statement } = StatementBlock.parse(JSON.parse(prompt));
        return content({
          verdict: quotes.join(' ').includes(statement) ? 'supported' : 'unsupported',
        });
      }
      case 'sentence-kinds': {
        const { premises, sentences } = KindsBlock.parse(JSON.parse(prompt));
        const comb = premises.some((premise) => premise.includes('square cells'));
        return content({
          kinds: sentences.map(({ text }) =>
            comb && text.startsWith('So') ? 'interpretation' : 'course-claim',
          ),
        });
      }
      case 'topic-tags': {
        const { passage } = PassageBlock.parse(JSON.parse(prompt));
        return content({ tags: [passage.split('\n')[0]?.toLowerCase() ?? ''] });
      }
      default:
        return {
          status: 'backend-failed',
          cause: 'request-error',
          reason: `unscripted output ${wire.output.name}`,
        };
    }
  };

/** Says every statement is supported. */
export const credulous: Respond = (wire) =>
  wire.output.name === 'verdict' ? content({ verdict: 'supported' }) : tutor(false)(wire);
