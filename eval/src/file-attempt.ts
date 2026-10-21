/** A read whose file or directory may be absent: an absence is a value, any other failure throws. */
export type Attempt<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

const isMissing = (error: unknown): boolean =>
  error instanceof Error &&
  'code' in error &&
  (error.code === 'ENOENT' || error.code === 'ENOTDIR');

export const attempt = <T>(read: () => T): Attempt<T> => {
  try {
    return { ok: true, value: read() };
  } catch (error) {
    if (isMissing(error)) return { ok: false };
    throw error;
  }
};
