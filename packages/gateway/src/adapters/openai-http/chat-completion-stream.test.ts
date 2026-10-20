import { describe, expect, it } from 'vitest';
import { readChatCompletionStream } from './chat-completion-stream';

const delta = (content: string | null, finishReason: string | null = null) => ({
  choices: [{ index: 0, delta: { content }, finish_reason: finishReason }],
});
/** A role-only first chunk, as servers send it: no content and no finish_reason. */
const opening = { choices: [{ index: 0, delta: { role: 'assistant' } }] };
const usage = { choices: [], usage: { prompt_tokens: 16, completion_tokens: 3 } };
const data = (chunk: object): string => `data: ${JSON.stringify(chunk)}\n\n`;
const DONE = 'data: [DONE]\n\n';

/** One read per piece, so the counting clock below ticks once per piece. */
const body = (pieces: readonly string[], cancelled: { value: boolean } = { value: false }) => {
  const queue = pieces.map((piece) => new TextEncoder().encode(piece));
  return new ReadableStream<Uint8Array>({
    pull: (controller) => {
      const next = queue.shift();
      if (next === undefined) controller.close();
      else controller.enqueue(next);
    },
    cancel: () => {
      cancelled.value = true;
    },
  });
};

/** 10, 20, 30, … ms: the nth resolved read is timed at 10n. */
const tickingClock = (): (() => number) => {
  let ms = 0;
  return () => (ms += 10);
};

const read = (pieces: readonly string[]) => readChatCompletionStream(body(pieces), tickingClock());

describe('readChatCompletionStream', () => {
  it('joins the content deltas and times the first and last content token', async () => {
    const pieces = [
      data(opening),
      data(delta('')),
      data(delta('{"text":')),
      data(delta('"a"}')),
      data(delta(null, 'stop')),
      data(usage),
      DONE,
    ];
    await expect(read(pieces)).resolves.toEqual({
      status: 'read',
      timed: {
        reply: { status: 'content', content: '{"text":"a"}' },
        timing: {
          firstTokenMs: 30,
          lastTokenMs: 40,
          usage: { promptTokens: 16, completionTokens: 3 },
        },
      },
    });
  });

  it('reports a length finish as truncated', async () => {
    const result = await read([data(delta('{"te', 'length')), data(usage), DONE]);
    expect(result).toMatchObject({ timed: { reply: { status: 'truncated', content: '{"te' } } });
  });

  it('has null usage when the server sent none', async () => {
    const result = await read([data(delta('{}', 'stop')), DONE]);
    expect(result).toMatchObject({ timed: { timing: { usage: null } } });
  });

  it('has null timing when no content token arrived', async () => {
    const result = await read([data(delta(null, 'stop')), DONE]);
    expect(result).toEqual({
      status: 'read',
      timed: { reply: { status: 'content', content: '' }, timing: null },
    });
  });

  it('reassembles a chunk split across reads, with CRLF line ends', async () => {
    const line = data(delta('{}', 'stop')).replaceAll('\n', '\r\n');
    const result = await read([line.slice(0, 12), line.slice(12), DONE.replaceAll('\n', '\r\n')]);
    expect(result).toMatchObject({
      timed: { reply: { content: '{}' }, timing: { firstTokenMs: 20 } },
    });
  });

  it('skips SSE comment and event lines', async () => {
    const result = await read([
      ': keep-alive\n\nevent: message\n',
      data(delta('{}', 'stop')),
      DONE,
    ]);
    expect(result).toMatchObject({ timed: { reply: { content: '{}' } } });
  });

  it('reads a last line that has no line end', async () => {
    const result = await read([data(delta('{}', 'stop')).trimEnd()]);
    expect(result).toMatchObject({ status: 'read', timed: { reply: { content: '{}' } } });
  });

  it('accepts a stream that closes after its finish without [DONE]', async () => {
    const result = await read([data(delta('{}', 'stop'))]);
    expect(result).toMatchObject({ status: 'read' });
  });

  it('stops at [DONE] and cancels the body', async () => {
    const cancelled = { value: false };
    const pieces = [data(delta('{}', 'stop')), DONE, 'data: not json\n\n'];
    const result = await readChatCompletionStream(body(pieces, cancelled), tickingClock());
    expect(result).toMatchObject({ status: 'read' });
    expect(cancelled.value).toBe(true);
  });

  it('fails a stream that ends without a finish_reason', async () => {
    await expect(read([data(delta('{}')), DONE])).resolves.toEqual({
      status: 'protocol-failed',
      issue: 'the stream ended without a finish_reason',
    });
  });

  it('fails a body with no data line, quoting its opening', async () => {
    await expect(read(['{"choices":[]}'])).resolves.toEqual({
      status: 'protocol-failed',
      issue: 'the body held no event-stream data line: {"choices":[]}',
    });
  });

  it('fails a chunk that is not JSON, quoting it', async () => {
    const result = await read(['data: {oops\n\n']);
    expect(result.status === 'protocol-failed' && result.issue).toMatch(/not JSON: \{oops/);
  });

  it('fails a chunk that is not a chat completion chunk, quoting the server error', async () => {
    const result = await read([data({ error: { message: 'model crashed' } })]);
    expect(result.status === 'protocol-failed' && result.issue).toMatch(
      /not a chat completion chunk: .*choices.*model crashed/s,
    );
  });
});
