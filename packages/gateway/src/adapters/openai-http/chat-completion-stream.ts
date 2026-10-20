import { z } from 'zod';
import type { GeneratorReply } from '../../chat';
import type { GeneratorUsage, TimedReply } from '../../generator-timing';
import { ChatCompletionChunk } from './chat-completion';

const DATA_FIELD = 'data:';
const DONE = '[DONE]';
const PAYLOAD_EXCERPT_CHARS = 500;

export type StreamRead =
  | { readonly status: 'read'; readonly timed: TimedReply }
  | { readonly status: 'protocol-failed'; readonly issue: string };

type ProtocolFailure = Extract<StreamRead, { status: 'protocol-failed' }>;

const protocolFailed = (issue: string): ProtocolFailure => ({ status: 'protocol-failed', issue });

const parsedChunk = (
  payload: string,
): { readonly status: 'chunk'; readonly chunk: ChatCompletionChunk } | ProtocolFailure => {
  const excerpt = payload.slice(0, PAYLOAD_EXCERPT_CHARS);
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return protocolFailed(`a stream chunk is not JSON: ${excerpt}`);
  }
  const chunk = ChatCompletionChunk.safeParse(json);
  return chunk.success
    ? { status: 'chunk', chunk: chunk.data }
    : protocolFailed(`not a chat completion chunk: ${z.prettifyError(chunk.error)}: ${excerpt}`);
};

/** Folds a stream's chunks into one reply, timing each content token by when its read resolved. */
class StreamedReply {
  #content = '';
  #finishReason: string | null = null;
  #firstTokenMs: number | null = null;
  #lastTokenMs = 0;
  #usage: GeneratorUsage | null = null;
  #sawData = false;

  /** `done` at the `[DONE]` sentinel; a line that is not a data field is skipped, as SSE comments are. */
  line(line: string, atMs: number): 'more' | 'done' | ProtocolFailure {
    if (!line.startsWith(DATA_FIELD)) return 'more';
    this.#sawData = true;
    const payload = line.slice(DATA_FIELD.length).trim();
    if (payload === DONE) return 'done';
    const parsed = parsedChunk(payload);
    if (parsed.status === 'protocol-failed') return parsed;
    const { chunk } = parsed;
    const [choice] = chunk.choices;
    const text = choice?.delta.content ?? '';
    if (text !== '') {
      this.#content += text;
      this.#firstTokenMs ??= atMs;
      this.#lastTokenMs = atMs;
    }
    if (choice?.finish_reason != null) this.#finishReason = choice.finish_reason;
    if (chunk.usage != null) {
      const { prompt_tokens: promptTokens, completion_tokens: completionTokens } = chunk.usage;
      this.#usage = { promptTokens, completionTokens };
    }
    return 'more';
  }

  /** `head` is the body's opening text, quoted when no data line came: a server that did not stream. */
  ended(head: string): StreamRead {
    if (!this.#sawData) return protocolFailed(`the body held no event-stream data line: ${head}`);
    if (this.#finishReason === null)
      return protocolFailed('the stream ended without a finish_reason');
    const content = this.#content;
    const reply: GeneratorReply =
      this.#finishReason === 'length'
        ? { status: 'truncated', content }
        : { status: 'content', content };
    const timing =
      this.#firstTokenMs === null
        ? null
        : { firstTokenMs: this.#firstTokenMs, lastTokenMs: this.#lastTokenMs, usage: this.#usage };
    return { status: 'read', timed: { reply, timing } };
  }
}

/**
 * Reads an OpenAI chat-completion event stream to its end; `elapsedMs` is read once per resolved read.
 * Rejects only as the body's own reads reject (an abort, a reset), which the caller classifies.
 */
export const readChatCompletionStream = async (
  body: ReadableStream<Uint8Array>,
  elapsedMs: () => number,
): Promise<StreamRead> => {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  const streamed = new StreamedReply();
  let partial = '';
  let head = '';
  for (;;) {
    const { done, value } = await reader.read();
    const atMs = elapsedMs();
    if (!done) head = (head + value).slice(0, PAYLOAD_EXCERPT_CHARS);
    const lines = done ? [partial] : (partial + value).split('\n');
    partial = done ? '' : (lines.pop() ?? '');
    for (const line of lines) {
      const outcome = streamed.line(line, atMs);
      if (outcome === 'more') continue;
      await reader.cancel();
      return outcome === 'done' ? streamed.ended(head) : outcome;
    }
    if (done) return streamed.ended(head);
  }
};
