/** A caught error in one line; the name is what tells a `TimeoutError` from a refused connection. */
export const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);
