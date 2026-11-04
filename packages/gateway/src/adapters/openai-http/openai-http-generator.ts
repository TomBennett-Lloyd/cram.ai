import {
  type BackendFailureCause,
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
import type { HttpGeneratorConfig, Sampling } from '../../role-config';
import type { ServedArtefact } from '../../served-artefact';
import { chatCompletionBody, chatCompletionsUrl } from './chat-completion';
import { readChatCompletionStream, type StreamRead } from './chat-completion-stream';
import { describeError } from '../describe-error';
import { BODY_EXCERPT_CHARS } from './http-failure';
import { type ServedCheck, showOutcome } from './served-model';

const failed = (cause: BackendFailureCause, reason: string): TimedReply => ({
  reply: { status: 'backend-failed', cause, reason },
  timing: null,
});

/** A timeout after content arrived keeps that content, cut off (#578); `timedOut` is the call's own signal. */
const streamedReply = (read: StreamRead, at: string, timedOut: boolean): TimedReply => {
  switch (read.status) {
    case 'read':
      return read.timed;
    case 'protocol-failed':
      return failed('protocol', `${at}: ${read.issue}`);
    case 'interrupted':
      if (timedOut && read.content !== '')
        return {
          reply: { status: 'truncated', content: read.content, cutOffAt: 'timeout' },
          timing: read.timing,
        };
      return failed(timedOut ? 'timeout' : 'request-error', `${at}: ${describeError(read.error)}`);
  }
};

/** The generator over an OpenAI-compatible server (`docs/adr/0003-model-roles-and-backends.md` § Decision (c)). */
export class OpenAiHttpGenerator implements Generator {
  readonly pin: GeneratorPin;
  readonly sampling: Sampling;
  readonly maxOutputTokens: number;
  readonly served: ServedArtefact;
  readonly #config: HttpGeneratorConfig;
  readonly #url: URL;
  readonly #now: () => number;

  constructor(
    config: HttpGeneratorConfig,
    served: ServedArtefact,
    now: () => number = () => performance.now(),
  ) {
    this.#config = config;
    this.pin = this.#config.pin;
    this.sampling = this.#config.sampling;
    this.maxOutputTokens = this.#config.maxOutputTokens;
    this.served = served;
    this.#url = chatCompletionsUrl(this.#config.endpoint);
    this.#now = now;
  }

  async timedReply(wire: ChatWireRequest): Promise<TimedReply> {
    const at = `POST ${this.#url.href}`;
    const startedAt = this.#now();
    const signal = AbortSignal.timeout(this.#config.timeoutMs);
    try {
      const response = await fetch(this.#url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(chatCompletionBody(this.#config, wire)),
        redirect: 'error',
        signal,
      });
      if (!response.ok) {
        const excerpt = (await response.text()).slice(0, BODY_EXCERPT_CHARS);
        return failed('http-status', `${at}: HTTP ${String(response.status)}: ${excerpt}`);
      }
      if (response.body === null) return failed('protocol', `${at}: no response body`);
      const read = await readChatCompletionStream(response.body, () => this.#now() - startedAt);
      return streamedReply(read, at, signal.aborted);
    } catch (error) {
      return failed(signal.aborted ? 'timeout' : 'request-error', `${at}: ${describeError(error)}`);
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

/**
 * Asks the server which weights it serves as `servedModel`, through Ollama's `/api/show` on the
 * endpoint's origin; a server that cannot be asked is `unverified`, never a failure (#171).
 */
export const checkServedModel = async (config: HttpGeneratorConfig): Promise<ServedCheck> => {
  const url = new URL('/api/show', config.endpoint);
  const at = `POST ${url.href} for ${config.servedModel}`;
  let body: unknown;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.servedModel }),
      redirect: 'error',
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!response.ok) {
      const excerpt = (await response.text()).slice(0, BODY_EXCERPT_CHARS);
      return { status: 'unverified', reason: `${at}: HTTP ${String(response.status)}: ${excerpt}` };
    }
    body = await response.json();
  } catch (error) {
    return { status: 'unverified', reason: `${at}: ${describeError(error)}` };
  }
  return showOutcome(at, body, config.pin);
};

/** The server named weights the pin does not: the operator's to fix in the server or the pin. */
export interface GeneratorLoadFailure {
  readonly status: 'load-failed';
  readonly role: 'generator';
  readonly reason: 'served-mismatch';
  readonly detail: string;
}

export type GeneratorLoad<T extends Generator = Generator> =
  { readonly status: 'loaded'; readonly generator: T } | GeneratorLoadFailure;

/** Checks the served weights before the generator exists; only a mismatch refuses (#171). */
export const loadOpenAiHttpGenerator = async (
  config: HttpGeneratorConfig,
): Promise<GeneratorLoad<OpenAiHttpGenerator>> => {
  const check = await checkServedModel(config);
  return check.status === 'mismatch'
    ? { status: 'load-failed', role: 'generator', reason: 'served-mismatch', detail: check.detail }
    : { status: 'loaded', generator: new OpenAiHttpGenerator(config, check) };
};
