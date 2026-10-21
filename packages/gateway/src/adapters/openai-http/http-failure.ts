export const BODY_EXCERPT_CHARS = 500;

export const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);
