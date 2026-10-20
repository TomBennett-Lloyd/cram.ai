import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseJsonLines, parseJsonText } from './json-text';

const Item = z.strictObject({ n: z.number() });

describe('parseJsonLines', () => {
  it('parses one value per line, with or without a final newline', () => {
    const items = [{ n: 1 }, { n: 2 }];
    expect(parseJsonLines('{"n":1}\n{"n":2}\n', Item)).toEqual({ status: 'parsed', items });
    expect(parseJsonLines('{"n":1}\n{"n":2}', Item)).toEqual({ status: 'parsed', items });
  });

  it('parses an empty file as no items', () => {
    expect(parseJsonLines('', Item)).toEqual({ status: 'parsed', items: [] });
  });

  it('refuses a blank line before the last, naming it', () => {
    expect(parseJsonLines('{"n":1}\n\n{"n":2}\n', Item)).toMatchObject({
      status: 'invalid',
      line: 2,
    });
  });

  it('names the line that is not JSON', () => {
    expect(parseJsonLines('{"n":1}\n{n:2}\n', Item)).toMatchObject({ status: 'invalid', line: 2 });
  });

  it('names the line the schema refuses, with the schema message', () => {
    const result = parseJsonLines('{"n":1}\n{"n":1,"extra":true}\n', Item);
    expect(result).toMatchObject({ status: 'invalid', line: 2 });
    expect(result.status === 'invalid' && result.message).toContain('extra');
  });
});

describe('parseJsonText', () => {
  it('returns the parsed value', () => {
    expect(parseJsonText('{"n":3}', Item)).toEqual({ ok: true, value: { n: 3 } });
  });
});
