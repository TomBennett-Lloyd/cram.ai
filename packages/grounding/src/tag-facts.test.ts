import type { ChatRequest, ChatResult, GeneratorReply } from '@cram/gateway';
import { ChunkNo, type SlideChunk, SourceId } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { estimateTokens } from './prompt-budget';
import { fakeGateway, generatorRecording, generatorReplies, slide } from './fake-gateway-fixture';
import { TAG_MAX_CHARS, tagRequest, TAGS_PER_FACT } from './prompts/tag-prompt';
import { slideText } from './slide-text';
import { lectureFacts, type TagFact, tagFacts } from './tag-facts';

const LECTURE = 'The apiary year';

const fact = (id: string, body: string, chunkNo = 1, title = 'Swarming'): TagFact => {
  const chunk: SlideChunk = {
    chunkNo: ChunkNo.parse(chunkNo),
    title,
    body,
    speakerNotes: '',
    imageCaptions: [],
  };
  return { sourceId: SourceId.parse(id), lectureTitle: LECTURE, chunk };
};

const swarm = fact('l5/3', 'Swarm watch begins when the bloom count passes forty');
const stilling = fact('l5/6', 'Bees sleep through the winter');

const requestOf = ({ lectureTitle, chunk }: TagFact) => tagRequest(lectureTitle, slideText(chunk));
const replying = (of: TagFact, reply: GeneratorReply) => generatorRecording(requestOf(of), reply);
const topics = (of: TagFact, values: readonly string[]) =>
  generatorReplies(requestOf(of), { tags: values });

const ref = ({ sourceId, chunk }: TagFact) => ({ sourceId, chunkNo: chunk.chunkNo });

describe('tagFacts', () => {
  it('makes one call per fact and returns its tags, in the facts’ order', async () => {
    const gateway = fakeGateway([
      topics(swarm, ['swarming', 'bloom count']),
      topics(stilling, ['the stilling']),
    ]);
    await expect(tagFacts([stilling, swarm], gateway)).resolves.toEqual([
      { ...ref(stilling), status: 'tagged', tags: ['the stilling'] },
      { ...ref(swarm), status: 'tagged', tags: ['swarming', 'bloom count'] },
    ]);
  });

  it('shows the passage as the chunk’s fields beside the lecture’s title', async () => {
    const two = fact('l5/3', 'Second half', 2, 'Swarming');
    const gateway = fakeGateway([
      generatorReplies(tagRequest(LECTURE, 'Swarming\nSecond half'), { tags: ['swarming'] }),
    ]);
    await expect(tagFacts([two], gateway)).resolves.toEqual([
      { ...ref(two), status: 'tagged', tags: ['swarming'] },
    ]);
  });

  it('keeps a fact with no topic as tagged with none', async () => {
    await expect(tagFacts([swarm], fakeGateway([topics(swarm, [])]))).resolves.toEqual([
      { ...ref(swarm), status: 'tagged', tags: [] },
    ]);
  });

  it('trims each topic, drops blank ones and keeps the first of each case-folded spelling', async () => {
    const gateway = fakeGateway([
      topics(swarm, [
        ' swarming ',
        ' \t',
        'Bloom count',
        'Swarming',
        'bloom  count',
        'bloom count',
      ]),
    ]);
    await expect(tagFacts([swarm], gateway)).resolves.toEqual([
      { ...ref(swarm), status: 'tagged', tags: ['swarming', 'Bloom count', 'bloom  count'] },
    ]);
  });

  it.each<[string, GeneratorReply]>([
    [
      'one topic too many',
      { status: 'content', content: JSON.stringify({ tags: Array(TAGS_PER_FACT + 1).fill('a') }) },
    ],
    [
      'a topic one character too long',
      { status: 'content', content: JSON.stringify({ tags: ['a'.repeat(TAG_MAX_CHARS + 1)] }) },
    ],
    ['a key beside the topics', { status: 'content', content: '{"tags":["a"],"why":"b"}' }],
    ['the tags under another key', { status: 'content', content: '{"topics":["a"]}' }],
    ['a topic that is not a string', { status: 'content', content: '{"tags":[1]}' }],
    ['not JSON', { status: 'content', content: 'swarming, bloom count' }],
  ])('leaves a fact whose reply is %s untagged and goes on to the next', async (_, reply) => {
    const gateway = fakeGateway([replying(swarm, reply), topics(stilling, ['the stilling'])]);
    await expect(tagFacts([swarm, stilling], gateway)).resolves.toEqual([
      { ...ref(swarm), status: 'untagged', reason: 'invalid-output' },
      { ...ref(stilling), status: 'tagged', tags: ['the stilling'] },
    ]);
  });

  it('leaves a fact whose reply is cut off untagged as cut off, and goes on to the next', async () => {
    const cut = {
      status: 'truncated',
      content: '{"tags":["swar',
      cutOffAt: 'token-limit',
    } as const;
    const gateway = fakeGateway([replying(swarm, cut), topics(stilling, ['the stilling'])]);
    await expect(tagFacts([swarm, stilling], gateway)).resolves.toEqual([
      { ...ref(swarm), status: 'untagged', reason: 'cut-off' },
      { ...ref(stilling), status: 'tagged', tags: ['the stilling'] },
    ]);
  });

  it('accepts the bounds themselves: TAGS_PER_FACT topics, each TAG_MAX_CHARS characters', async () => {
    const six = Array.from(
      { length: TAGS_PER_FACT },
      (_, n) => `${String(n)}${'a'.repeat(TAG_MAX_CHARS - 1)}`,
    );
    await expect(tagFacts([swarm], fakeGateway([topics(swarm, six)]))).resolves.toEqual([
      { ...ref(swarm), status: 'tagged', tags: six },
    ]);
  });

  it('ends the pass at a backend failure, reporting every fact left without calling for it', async () => {
    const third = fact('l5/4', 'The main flow runs from midsummer');
    const calls: string[] = [];
    const gateway = fakeGateway([
      topics(swarm, ['swarming']),
      replying(stilling, {
        status: 'backend-failed',
        cause: 'request-error',
        reason: 'connection refused',
      }),
    ]);
    const counting = {
      chat: <T>(request: ChatRequest<T>): Promise<ChatResult<T>> => {
        calls.push(request.messages[1]?.content ?? '');
        return gateway.generator.chat(request);
      },
    };
    await expect(tagFacts([swarm, stilling, third], { generator: counting })).resolves.toEqual([
      { ...ref(swarm), status: 'tagged', tags: ['swarming'] },
      { ...ref(stilling), status: 'untagged', reason: 'backend-failed' },
      { ...ref(third), status: 'untagged', reason: 'backend-failed' },
    ]);
    expect(calls).toHaveLength(2);
  });

  it('makes no call for a fact whose prompt is over the budget, or that has no text', async () => {
    const empty = fact('l5/7', ' ', 1, '');
    const cost = requestOf(swarm).messages.reduce(
      (n, { content }) => n + estimateTokens(content),
      0,
    );
    const atBudget = fakeGateway([topics(swarm, ['swarming'])]);
    await expect(
      tagFacts([empty, swarm], { generator: atBudget.generator, budget: cost }),
    ).resolves.toEqual([
      { ...ref(empty), status: 'untagged', reason: 'no-text' },
      { ...ref(swarm), status: 'tagged', tags: ['swarming'] },
    ]);
    await expect(
      tagFacts([swarm], { generator: fakeGateway([]).generator, budget: cost - 1 }),
    ).resolves.toEqual([{ ...ref(swarm), status: 'untagged', reason: 'over-budget' }]);
  });

  it('reports an over-budget fact as over the budget even after a backend failure', async () => {
    const long = fact('l5/9', 'Swarm '.repeat(200));
    const cost = requestOf(swarm).messages.reduce(
      (n, { content }) => n + estimateTokens(content),
      0,
    );
    const gateway = fakeGateway([
      replying(swarm, { status: 'backend-failed', cause: 'request-error', reason: 'down' }),
    ]);
    await expect(
      tagFacts([swarm, long], { generator: gateway.generator, budget: cost }),
    ).resolves.toEqual([
      { ...ref(swarm), status: 'untagged', reason: 'backend-failed' },
      { ...ref(long), status: 'untagged', reason: 'over-budget' },
    ]);
  });

  it('propagates a rejected call, which is a bug or a replay miss', async () => {
    await expect(tagFacts([swarm], fakeGateway([]))).rejects.toThrow(/no generator recording/);
  });
});

describe('lectureFacts', () => {
  it('reads every chunk of each slide but a references slide’s, under the slide’s lecture title', () => {
    const queen = slide('l1/1', 'One queen per colony');
    const references = slide('l1/2', 'Guild handbook', { kind: 'references' });
    const comb = slide('l1/3', 'Square cells', { kind: 'image-only', derived: true });
    const chunks = (id: string) => [
      swarm.chunk,
      { ...swarm.chunk, chunkNo: ChunkNo.parse(2), body: id },
    ];
    const read: string[] = [];
    const facts = lectureFacts([queen, references, comb], (id) => {
      read.push(id);
      return chunks(id);
    });
    expect(read).toEqual(['l1/1', 'l1/3']);
    expect(
      facts.map(({ sourceId, lectureTitle, chunk }) => [sourceId, lectureTitle, chunk.chunkNo]),
    ).toEqual([
      ['l1/1', 'The Hive', 1],
      ['l1/1', 'The Hive', 2],
      ['l1/3', 'The Hive', 1],
      ['l1/3', 'The Hive', 2],
    ]);
  });
});
