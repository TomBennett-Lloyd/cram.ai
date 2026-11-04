import type { GeneratorReply } from '@cram/gateway';
import { describe, expect, it } from 'vitest';
import { classifySentenceKinds } from './classify-sentence-kinds';
import { fakeGateway, kindsRecording, slide } from './fake-gateway-fixture';
import { slideText } from './slide-text';

const hive = slide('l1/1', 'Worker bees are male.');
const TWO = ['A worker is a bee of the working caste.', 'Workers live six weeks.'];
const premises = [slideText(hive.record)];

const classify = (reply: Parameters<typeof kindsRecording>[2], sentences = TWO) =>
  classifySentenceKinds(
    sentences,
    premises,
    fakeGateway([kindsRecording(sentences, [hive], reply)]).generator,
  );

describe('classifySentenceKinds', () => {
  it('makes no call for no sentence', async () => {
    await expect(classifySentenceKinds([], premises, fakeGateway([]).generator)).resolves.toEqual(
      [],
    );
  });

  it('returns one kind per sentence, in the order given', async () => {
    await expect(classify(['interpretation', 'course-claim'])).resolves.toEqual([
      'interpretation',
      'course-claim',
    ]);
    await expect(classify(['course-claim', 'interpretation'])).resolves.toEqual([
      'course-claim',
      'interpretation',
    ]);
  });

  it.each<[string, GeneratorReply]>([
    ['one kind short', { status: 'content', content: '{"kinds":["interpretation"]}' }],
    [
      'one kind long',
      { status: 'content', content: JSON.stringify({ kinds: Array(3).fill('interpretation') }) },
    ],
    ['a kind outside the two', { status: 'content', content: '{"kinds":["fact","fact"]}' }],
    [
      'a kind in another case',
      { status: 'content', content: '{"kinds":["Interpretation","course-claim"]}' },
    ],
    [
      'a kind spelt with a space',
      { status: 'content', content: '{"kinds":["interpretation","course claim"]}' },
    ],
    [
      'a key beside the kinds',
      { status: 'content', content: '{"kinds":["interpretation","course-claim"],"why":"x"}' },
    ],
    ['the kinds under another key', { status: 'content', content: '{"kind":["interpretation"]}' }],
    ['null', { status: 'content', content: 'null' }],
    ['not JSON', { status: 'content', content: 'interpretation, interpretation' }],
    [
      'cut off',
      {
        status: 'truncated',
        content: '{"kinds":["interpretation","inter',
        cutOffAt: 'token-limit',
      },
    ],
    [
      'a backend failure',
      { status: 'backend-failed', cause: 'request-error', reason: 'connection refused' },
    ],
  ])('fails closed on a reply that is %s: every sentence a course claim', async (_, reply) => {
    await expect(classify(reply)).resolves.toEqual(['course-claim', 'course-claim']);
  });
});
