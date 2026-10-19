import { z } from 'zod';
import {
  type ChatRequest,
  type ChatResult,
  chatResult,
  type ChatWireRequest,
  chatWireRequest,
  type GeneratorReply,
} from '../../chat';
import type { Generator } from '../../model-gateway';
import type { GeneratorPin } from '../../pin';
import { HttpGeneratorConfig } from '../../role-config';
import { ChatCompletion, chatCompletionBody, chatCompletionsUrl } from './chat-completion';

const BODY_EXCERPT_CHARS = 500;

const failed = (reason: string): GeneratorReply => ({ status: 'backend-failed', reason });

const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/**
 * The generator over an OpenAI-compatible server (`docs/adr/0003-model-roles-and-backends.md` § Decision (c)).
 * Failure policy: one attempt, no retry, `timeoutMs` bounding the whole call, redirects refused;
 * every transport or protocol failure is `backend-failed`.
 */
export class OpenAiHttpGenerator implements Generator {
  readonly pin: GeneratorPin;
  readonly #config: HttpGeneratorConfig;
  readonly #url: URL;

  constructor(config: HttpGeneratorConfig) {
    this.#config = HttpGeneratorConfig.parse(config);
    this.pin = this.#config.pin;
    this.#url = chatCompletionsUrl(this.#config.endpoint);
  }

  /** The server's reply before parsing: what a recording of this call stores. */
  async reply(wire: ChatWireRequest): Promise<GeneratorReply> {
    const at = `POST ${this.#url.href}`;
    let payload: unknown;
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
      payload = await response.json();
    } catch (error) {
      return failed(`${at}: ${describeError(error)}`);
    }
    const completion = ChatCompletion.safeParse(payload);
    if (!completion.success) {
      return failed(`${at}: not a chat completion: ${z.prettifyError(completion.error)}`);
    }
    const [choice] = completion.data.choices;
    const { content } = choice.message;
    return choice.finish_reason === 'length'
      ? { status: 'truncated', content }
      : { status: 'content', content };
  }

  async chat<T>(request: ChatRequest<T>): Promise<ChatResult<T>> {
    return chatResult(await this.reply(chatWireRequest(request)), request.output.schema);
  }
}
