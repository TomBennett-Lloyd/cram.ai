import { z } from 'zod';

export const ChatMessage = z.strictObject({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

/** The model is constrained to `schema`'s input side, and its output is parsed by `schema`. */
export interface ChatOutputSpec<T> {
  readonly name: string;
  readonly schema: z.ZodType<T>;
}

export interface ChatRequest<T> {
  readonly messages: readonly ChatMessage[];
  readonly output: ChatOutputSpec<T>;
}

/** The request content that reaches a backend, which is also what a recording is keyed by (`docs/adr/0005-evaluation-as-gate.md` § Decision (e)). */
export const ChatWireRequest = z.strictObject({
  messages: z.array(ChatMessage).min(1),
  output: z.strictObject({
    name: z.string().regex(/^[\w-]{1,64}$/),
    jsonSchema: z.record(z.string(), z.unknown()),
  }),
});
export type ChatWireRequest = z.infer<typeof ChatWireRequest>;

export const chatWireRequest = <T>(request: ChatRequest<T>): ChatWireRequest =>
  ChatWireRequest.parse({
    messages: request.messages,
    output: {
      name: request.output.name,
      jsonSchema: z.toJSONSchema(request.output.schema, { io: 'input' }),
    },
  });

export type ChatResult<T> =
  | { readonly status: 'completed'; readonly value: T }
  | { readonly status: 'invalid-output'; readonly content: string; readonly issue: string }
  | { readonly status: 'backend-failed'; readonly reason: string };

/** Parses a model's text reply; shared by every generator so a replay takes the live path. */
export const chatOutcome = <T>(content: string, schema: z.ZodType<T>): ChatResult<T> => {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (error) {
    const issue = error instanceof Error ? error.message : String(error);
    return { status: 'invalid-output', content, issue: `not JSON: ${issue}` };
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { status: 'completed', value: parsed.data }
    : { status: 'invalid-output', content, issue: z.prettifyError(parsed.error) };
};
