import { z } from 'zod';

export type JsonTextParse<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

const parseJson = (text: string): JsonTextParse<unknown> => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, message: error.message };
    throw error;
  }
};

export const parseJsonText = <S extends z.ZodType>(
  text: string,
  schema: S,
): JsonTextParse<z.infer<S>> => {
  const json = parseJson(text);
  if (!json.ok) return json;
  const result = schema.safeParse(json.value);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, message: z.prettifyError(result.error) };
};

export type JsonLinesParse<T> =
  | { readonly status: 'parsed'; readonly items: readonly T[] }
  | { readonly status: 'invalid'; readonly line: number; readonly message: string };

export const parseJsonLines = <S extends z.ZodType>(
  text: string,
  schema: S,
): JsonLinesParse<z.infer<S>> => {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const items: z.infer<S>[] = [];
  for (const [index, line] of lines.entries()) {
    const parsed = parseJsonText(line, schema);
    if (!parsed.ok) return { status: 'invalid', line: index + 1, message: parsed.message };
    items.push(parsed.value);
  }
  return { status: 'parsed', items };
};
