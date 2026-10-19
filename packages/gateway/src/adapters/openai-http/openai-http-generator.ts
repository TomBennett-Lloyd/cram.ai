import { type ChatRequest, type ChatResult, chatOutcome, chatWireRequest } from '../../chat';
import type { Generator } from '../../model-gateway';
import type { GeneratorPin } from '../../pin';
import { HttpGeneratorConfig } from '../../role-config';
import { ChatCompletion, chatCompletionBody, chatCompletionsUrl } from './chat-completion';

const failed = (reason: string) => ({ status: 'backend-failed', reason }) as const;

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

  async chat<T>(request: ChatRequest<T>): Promise<ChatResult<T>> {
    const body = JSON.stringify(chatCompletionBody(this.#config, chatWireRequest(request)));
    let payload: unknown;
    try {
      const response = await fetch(this.#url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(this.#config.timeoutMs),
      });
      if (!response.ok) return failed(`POST ${this.#url.href}: HTTP ${String(response.status)}`);
      payload = await response.json();
    } catch (error) {
      return failed(`POST ${this.#url.href}: ${describeError(error)}`);
    }
    const completion = ChatCompletion.safeParse(payload);
    if (!completion.success) return failed(`POST ${this.#url.href}: not a chat completion`);
    const [choice] = completion.data.choices;
    if (choice.finish_reason === 'length') {
      return {
        status: 'invalid-output',
        content: choice.message.content,
        issue: 'cut off at the token limit',
      };
    }
    return chatOutcome(choice.message.content, request.output.schema);
  }
}
