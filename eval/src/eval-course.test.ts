import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SentenceKind } from '@cram/grounding';
import { Verdict } from '@cram/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { auditEvalCourse, type EvalCourse } from './audit';
import { inContradictionSet } from './golden-question';
import {
  DECK_DIR,
  LABELS_FILE,
  QUESTIONS_FILE,
  readEvalCourse,
  SENTENCE_KINDS_FILE,
  TOPICS_FILE,
} from './read-eval-course';

const committed = (): EvalCourse => {
  const read = readEvalCourse();
  if (read.status !== 'read') throw new Error(`${read.where}: ${read.message}`);
  return read.course;
};

describe('the committed eval course', () => {
  it('audits clean', () => {
    expect(auditEvalCourse(committed())).toEqual([]);
  });

  // docs/adr/0005-evaluation-as-gate.md § Decision (a) and (b).
  it('holds a slide whose text exists only as an image', () => {
    const slides = committed().deck.flatMap((lecture) => lecture.slides);
    expect(slides.some((slide) => slide.imageOnly)).toBe(true);
  });

  it('holds contradiction items that cite a slide and items the deck does not cover', () => {
    const items = committed().questions.filter(inContradictionSet);
    expect(items.some((item) => item.expectedCitations.length > 0)).toBe(true);
    expect(items.some((item) => item.expectedCitations.length === 0)).toBe(true);
  });

  it('holds a question whose answer spans lectures', () => {
    const spans = committed().questions.map(
      (item) => new Set(item.expectedCitations.map((ref) => ref.lectureId)).size,
    );
    expect(Math.max(...spans)).toBeGreaterThan(1);
  });

  // docs/adr/0008-slide-chunking.md: the split path's regression slide. A WordPiece tokenizer gives
  // every whitespace word at least one token, so more words than the window is more tokens than it.
  it('holds a content slide longer than the embedder window', () => {
    const PINNED_EMBEDDER_WINDOW = 512; // model_max_length in the pinned embedder's tokenizer_config.json
    const words = committed()
      .deck.flatMap((lecture) => lecture.slides)
      .filter((slide) => !slide.imageOnly)
      .map((slide) => [slide.title, ...slide.body].join(' ').split(/\s+/).length);
    expect(Math.max(...words)).toBeGreaterThan(PINNED_EMBEDDER_WINDOW);
  });

  // docs/adr/0010-misspelt-golden-variants.md § Decision (b).
  it('holds misspelt variants on a sample of covered questions', () => {
    const carriers = committed().questions.filter(({ misspelt }) => misspelt.length > 0);
    expect(carriers.length).toBeGreaterThanOrEqual(3);
  });

  it('labels every verdict', () => {
    const verdicts = new Set(committed().labels.map((label) => label.verdict));
    expect([...verdicts].sort()).toEqual([...Verdict.options].sort());
  });

  // #426: a topic carried only by an example embedded in a slide about another topic.
  it('labels a slide with the topic of the example it uses', () => {
    const swarming = committed().topicLabels.find(
      ({ lectureId, slideNo }) => lectureId === 'lecture-05' && slideNo === 3,
    );
    expect(swarming?.tags).toEqual(['swarming', 'the bloom count']);
  });

  it('labels both sentence kinds', () => {
    const kinds = new Set(committed().sentenceKinds.map((label) => label.kind));
    expect([...kinds].sort()).toEqual([...SentenceKind.options].sort());
  });
});

describe('readEvalCourse', () => {
  const roots: string[] = [];
  const root = (files: Record<string, string>): string => {
    const dir = mkdtempSync(join(tmpdir(), 'cram-eval-'));
    roots.push(dir);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return dir;
  };
  afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const lecture = JSON.stringify({
    lectureId: 'l1',
    lectureTitle: 'One',
    slides: [{ slideNo: 1, title: 'T', body: ['Cells are square.'] }],
  });
  const questionLine = JSON.stringify({
    question: 'q',
    expectedCitations: [],
    mustNotContain: [],
  });
  const labelLine = JSON.stringify({ text: 't', quotes: ['Cells'], verdict: 'supported' });
  const kindLine = JSON.stringify({
    sentence: 's',
    premises: [{ lectureId: 'l1', slideNo: 1 }],
    kind: 'interpretation',
  });
  const topicLine = JSON.stringify({ lectureId: 'l1', slideNo: 1, tags: ['cells'] });

  it('reads a deck, its questions and its labels', () => {
    const dir = root({
      [`${DECK_DIR}/lecture-01.json`]: lecture,
      [QUESTIONS_FILE]: `${questionLine}\n`,
      [LABELS_FILE]: `${labelLine}\n`,
      [SENTENCE_KINDS_FILE]: `${kindLine}\n`,
      [TOPICS_FILE]: `${topicLine}\n`,
    });
    expect(readEvalCourse(dir)).toMatchObject({
      status: 'read',
      course: {
        deck: [{ lectureId: 'l1' }],
        questions: [{ question: 'q' }],
        labels: [{ text: 't' }],
        sentenceKinds: [{ sentence: 's' }],
        topicLabels: [{ tags: ['cells'] }],
      },
    });
  });

  it('reads only the deck directory’s JSON files', () => {
    const second = lecture.replace('"l1"', '"l2"');
    const dir = root({
      [`${DECK_DIR}/lecture-02.json`]: second,
      [`${DECK_DIR}/lecture-01.json`]: lecture,
      [`${DECK_DIR}/notes.txt`]: 'not a lecture',
      [QUESTIONS_FILE]: '',
      [LABELS_FILE]: '',
      [SENTENCE_KINDS_FILE]: '',
      [TOPICS_FILE]: '',
    });
    const read = readEvalCourse(dir);
    expect(read.status === 'read' && read.course.deck.map((l) => l.lectureId)).toEqual([
      'l1',
      'l2',
    ]);
  });

  it('names a missing deck directory', () => {
    expect(readEvalCourse(root({}))).toEqual({
      status: 'invalid',
      where: DECK_DIR,
      message: 'not found',
    });
  });

  it('names a deck path that is not a directory', () => {
    expect(readEvalCourse(root({ decks: 'a file' }))).toMatchObject({
      status: 'invalid',
      where: DECK_DIR,
    });
  });

  it('names an invalid lecture file', () => {
    const dir = root({ [`${DECK_DIR}/lecture-01.json`]: '{}' });
    expect(readEvalCourse(dir)).toMatchObject({
      status: 'invalid',
      where: `${DECK_DIR}/lecture-01.json`,
    });
  });

  it('names a missing questions file', () => {
    const dir = root({ [`${DECK_DIR}/lecture-01.json`]: lecture });
    expect(readEvalCourse(dir)).toMatchObject({ status: 'invalid', where: QUESTIONS_FILE });
  });

  it('names the questions line that does not parse', () => {
    const dir = root({
      [`${DECK_DIR}/lecture-01.json`]: lecture,
      [QUESTIONS_FILE]: `${questionLine}\n{}\n`,
    });
    expect(readEvalCourse(dir)).toMatchObject({ status: 'invalid', where: `${QUESTIONS_FILE}:2` });
  });

  it('names the labels line that does not parse', () => {
    const dir = root({
      [`${DECK_DIR}/lecture-01.json`]: lecture,
      [QUESTIONS_FILE]: '',
      [LABELS_FILE]: '{"text":"t"}\n',
    });
    expect(readEvalCourse(dir)).toMatchObject({ status: 'invalid', where: `${LABELS_FILE}:1` });
  });

  it('names a missing sentence-kind file, and the line of it that does not parse', () => {
    const files = {
      [`${DECK_DIR}/lecture-01.json`]: lecture,
      [QUESTIONS_FILE]: '',
      [LABELS_FILE]: '',
    };
    expect(readEvalCourse(root(files))).toMatchObject({
      status: 'invalid',
      where: SENTENCE_KINDS_FILE,
    });
    const bad = root({ ...files, [SENTENCE_KINDS_FILE]: `${kindLine}\n{"sentence":"s"}\n` });
    expect(readEvalCourse(bad)).toMatchObject({
      status: 'invalid',
      where: `${SENTENCE_KINDS_FILE}:2`,
    });
  });

  it('names a missing topics file, and the line of it that does not parse', () => {
    const files = {
      [`${DECK_DIR}/lecture-01.json`]: lecture,
      [QUESTIONS_FILE]: '',
      [LABELS_FILE]: '',
      [SENTENCE_KINDS_FILE]: '',
    };
    expect(readEvalCourse(root(files))).toMatchObject({ status: 'invalid', where: TOPICS_FILE });
    const bad = root({
      ...files,
      [TOPICS_FILE]: `${topicLine}\n{"lectureId":"l1","slideNo":1,"tags":[" cells"]}\n`,
    });
    expect(readEvalCourse(bad)).toMatchObject({ status: 'invalid', where: `${TOPICS_FILE}:2` });
    const twice = root({
      ...files,
      [TOPICS_FILE]: `${topicLine}\n{"lectureId":"l1","slideNo":2,"tags":["a","a"]}\n`,
    });
    expect(readEvalCourse(twice)).toMatchObject({ status: 'invalid', where: `${TOPICS_FILE}:2` });
  });
});
