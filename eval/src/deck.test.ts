import { describe, expect, it } from 'vitest';
import { parseDeck, slideText } from './deck';
import { slide } from './eval-fixture';

const lectureJson = (slides: unknown[]): string =>
  JSON.stringify({ lectureId: 'l1', lectureTitle: 'One', slides });

describe('parseDeck', () => {
  it('defaults a slide to visible text and no speaker notes', () => {
    const result = parseDeck([
      { name: 'l1.json', text: lectureJson([{ slideNo: 1, title: 'T', body: ['b'] }]) },
    ]);
    expect(result).toMatchObject({
      status: 'parsed',
      deck: [{ slides: [{ speakerNotes: '', imageOnly: false }] }],
    });
  });

  it('orders lectures by file name, whatever order the files arrive in', () => {
    const files = ['l2', 'l10', 'l1'].map((id) => ({
      name: `${id}.json`,
      text: JSON.stringify({
        lectureId: id,
        lectureTitle: id,
        slides: [{ slideNo: 1, title: '', body: [] }],
      }),
    }));
    const result = parseDeck(files);
    expect(result.status === 'parsed' && result.deck.map((l) => l.lectureId)).toEqual([
      'l1',
      'l10',
      'l2',
    ]);
  });

  it('names the file that is not JSON', () => {
    expect(parseDeck([{ name: 'bad.json', text: '{' }])).toMatchObject({
      status: 'invalid',
      file: 'bad.json',
    });
  });

  it('refuses a field the schema does not know, naming the file', () => {
    const text = lectureJson([{ slideNo: 1, title: 'T', body: [], answer: 'x' }]);
    expect(parseDeck([{ name: 'l1.json', text }])).toMatchObject({
      status: 'invalid',
      file: 'l1.json',
    });
  });

  it('refuses a lecture field the schema does not know', () => {
    const slides = [{ slideNo: 1, title: 'T', body: [] }];
    const text = JSON.stringify({ lectureId: 'l1', lectureTitle: 'One', slides, level: 1 });
    expect(parseDeck([{ name: 'l1.json', text }])).toMatchObject({ status: 'invalid' });
  });

  it('refuses a lecture with no slides', () => {
    expect(parseDeck([{ name: 'l1.json', text: lectureJson([]) }])).toMatchObject({
      status: 'invalid',
    });
  });
});

describe('slideText', () => {
  it('joins title, body and speaker notes in reading order', () => {
    expect(slideText(slide({ title: 'T', body: ['a', 'b'], speakerNotes: 'n' }))).toBe(
      'T\na\nb\nn',
    );
  });
});
