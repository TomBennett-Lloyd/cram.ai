import type { ChatRequest } from '@cram/gateway';
import { describe, expect, it } from 'vitest';
import { slide } from '../fake-gateway-fixture';
import { generationRequest } from './generation-prompt';
import { rewriteRequest } from './rewrite-prompt';
import { verifierRequest } from './verifier-prompt';

const hive = slide('l1/1', 'Worker bees are male.');
const comb = slide('l1/2', 'Bees build comb from square cells.');

const asked = (question: string, slides = [hive]) =>
  generationRequest({ kind: 'answer-sentence', question }, slides);
const statement = (text: string, quote: string) => ({ text, quotes: [quote] as const });

const prompts: readonly (readonly [string, (variant: number) => ChatRequest<unknown>])[] = [
  [
    'generation',
    (n) => (n === 0 ? asked('Who are the workers?') : asked('What shape are cells?', [hive, comb])),
  ],
  ['verifier', (n) => verifierRequest(n === 0 ? statement('a', 'q') : statement('b', 'r'))],
  ['rewrite', (n) => rewriteRequest(n === 0 ? statement('a', 'q') : statement('b', 'r'))],
];

const TRUTH_OR_CAVEAT =
  /\b(true|false|correct|incorrect|accurate|inaccurate|wrong|mainstream|caveat|misconception|in reality|actually|in fact)\b/i;

describe.each(prompts)('the %s prompt', (_, build) => {
  it('opens with a system message identical for every input, so its prefix caches', () => {
    const [first, second] = [build(0), build(1)];
    expect(first.messages[0].role).toBe('system');
    expect(first.messages[0]).toEqual(second.messages[0]);
    expect(first.messages.slice(1)).not.toEqual(second.messages.slice(1));
  });

  it('asks about what the slides say, never about what is true, and asks for no caveats', () => {
    expect(build(0).messages[0].content).not.toMatch(TRUTH_OR_CAVEAT);
  });
});

describe('generationRequest', () => {
  it('shows each retrieved slide under its id, then the question', () => {
    const user = asked('What shape are cells?', [hive, comb]).messages[1]?.content ?? '';
    expect(user).toBe(
      '<source id="l1/1">\nWorker bees are male.\n</source>\n\n' +
        '<source id="l1/2">\nBees build comb from square cells.\n</source>\n\n' +
        '<question>What shape are cells?</question>',
    );
  });

  it('shows a slide’s non-blank fields one to a line: title, body, notes, captions', () => {
    const noted = slide('l1/3', 'Drones never forage.', {
      title: 'Castes',
      speakerNotes: 'Ask who feeds them.',
      imageCaptions: ['A drone at rest'],
    });
    expect(asked('Do drones forage?', [noted]).messages[1]?.content).toBe(
      '<source id="l1/3">\nCastes\nDrones never forage.\nAsk who feeds them.\nA drone at rest\n</source>\n\n' +
        '<question>Do drones forage?</question>',
    );
  });
});

describe('verifierRequest', () => {
  it('shows the quotes and the statement and nothing else', () => {
    const request = verifierRequest({ text: 'Workers are male.', quotes: ['Worker bees', 'male'] });
    expect(request.messages.slice(1)).toEqual([
      {
        role: 'user',
        content:
          '<quote>Worker bees</quote>\n<quote>male</quote>\n<statement>Workers are male.</statement>',
      },
    ]);
  });
});
