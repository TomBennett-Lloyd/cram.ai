import {
  type ChatRequest,
  type ChatResult,
  chatResult,
  type ChatWireRequest,
  chatWireRequest,
  type GeneratorReply,
} from '../../chat';
import type { TimedReply } from '../../generator-timing';
import type { Generator } from '../../model-gateway';
import type { GeneratorPin } from '../../pin';
import { HttpGeneratorConfig, type Sampling } from '../../role-config';
import { chatCompletionBody, chatCompletionsUrl } from './chat-completion';
import { readChatCompletionStream } from './chat-completion-stream';

const BODY_EXCERPT_CHARS = 500;

const failed = (reason: string): TimedReply => ({
  reply: { status: 'backend-failed', reason },
  timing: null,
});

const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/**
 * The generator over an OpenAI-compatible server (`docs/adr/0003-model-roles-and-backends.md` § Decision (c)).
 * Failure policy: one attempt, no retry, `timeoutMs` bounding the whole call including the streamed body,
 * redirects refused; every transport or protocol failure is `backend-failed`.
 */
export class OpenAiHttpGenerator implements Generator {
  readonly pin: GeneratorPin;
  readonly sampling: Sampling;
  readonly #config: HttpGeneratorConfig;
  readonly #url: URL;
  readonly #now: () => number;

  constructor(config: HttpGeneratorConfig, now: () => number = () => performance.now()) {
    this.#config = HttpGeneratorConfig.parse(config);
    this.pin = this.#config.pin;
    this.sampling = this.#config.sampling;
    this.#url = chatCompletionsUrl(this.#config.endpoint);
    this.#now = now;
  }

  /** The server's reply before parsing, and the call's timing beside it (`TimedReply`). */
  async timedReply(wire: ChatWireRequest): Promise<TimedReply> {
    const at = `POST ${this.#url.href}`;
    const startedAt = this.#now();
    try {
      const response = await fetch(this.#url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(chatCompletionBody(this.#config, wire)),
        redirect: 'error',
        signal: AbortSignal.timeout(this.#config.timeoutMs),
      });
      if (!response.ok) {
        const excerpt = (await response.text()).slice(0, BODY_EXCERPT_CHARS);
        return failed(`${at}: HTTP ${String(response.status)}: ${excerpt}`);
      }
      if (response.body === null) return failed(`${at}: no response body`);
      const read = await readChatCompletionStream(response.body, () => this.#now() - startedAt);
      return read.status === 'read' ? read.timed : failed(`${at}: ${read.issue}`);
    } catch (error) {
      return failed(`${at}: ${describeError(error)}`);
    }
  }

  /** The server's reply before parsing: what a recording of this call stores. */
  async reply(wire: ChatWireRequest): Promise<GeneratorReply> {
    return (await this.timedReply(wire)).reply;
  }

  async chat<T>(request: ChatRequest<T>): Promise<ChatResult<T>> {
    return chatResult(await this.reply(chatWireRequest(request)), request.output.schema);
  }
}
