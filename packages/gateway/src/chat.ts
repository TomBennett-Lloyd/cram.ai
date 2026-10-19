import { z } from 'zod';

export const ChatMessage = z.strictObject({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

/** The name OpenAI-compatible servers accept for a `json_schema` response format. */
export const OutputName = z
  .string()
  .regex(/^[\w-]{1,64}$/)
  .brand<'OutputName'>();
export type OutputName = z.infer<typeof OutputName>;

/** The model is constrained to `schema`'s input side, and its output is parsed by `schema`. */
export interface ChatOutputSpec<T> {
  readonly name: OutputName;
  readonly schema: z.ZodType<T>;
}

export interface ChatRequest<T> {
  readonly messages: readonly [ChatMessage, ...ChatMessage[]];
  readonly output: ChatOutputSpec<T>;
}

export const ChatWireRequest = z.strictObject({
  messages: z.tuple([ChatMessage], ChatMessage),
  output: z.strictObject({ name: OutputName, jsonSchema: z.record(z.string(), z.unknown()) }),
});
export type ChatWireRequest = z.infer<typeof ChatWireRequest>;

/** Throws only on a caller bug: a field the types do not declare, or a schema JSON Schema cannot represent. */
export const chatWireRequest = <T>(request: ChatRequest<T>): ChatWireRequest =>
  ChatWireRequest.parse({
    messages: request.messages,
    output: {
      name: request.output.name,
      jsonSchema: z.toJSONSchema(request.output.schema, { io: 'input' }),
    },
  });

/** A generator backend's reply before parsing; what a recording stores. */
export const GeneratorReply = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('content'), content: z.string() }),
  z.strictObject({ status: z.literal('truncated'), content: z.string() }),
  z.strictObject({ status: z.literal('backend-failed'), reason: z.string() }),
]);
export type GeneratorReply = z.infer<typeof GeneratorReply>;

export type ChatResult<T> =
  | { readonly status: 'completed'; readonly value: T }
  | { readonly status: 'invalid-output'; readonly content: string; readonly issue: string }
  | { readonly status: 'backend-failed'; readonly reason: string };

const parsedContent = <T>(content: string, schema: z.ZodType<T>): ChatResult<T> => {
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

/** Shared by every generator, live or replayed, so both map a reply the same way. */
export const chatResult = <T>(reply: GeneratorReply, schema: z.ZodType<T>): ChatResult<T> => {
  switch (reply.status) {
    case 'content':
      return parsedContent(reply.content, schema);
    case 'truncated':
      return {
        status: 'invalid-output',
        content: reply.content,
        issue: 'cut off at the token limit',
      };
    case 'backend-failed':
      return reply;
  }
};
