const byKey = ([a]: [string, unknown], [b]: [string, unknown]): number =>
  a < b ? -1 : a > b ? 1 : 0;

const sortedKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(byKey)
        .map(([key, member]) => [key, sortedKeys(member)]),
    );
  }
  return value;
};

/** JSON with object keys sorted at every depth, so equal content gives equal text. */
export const canonicalJson = (value: unknown): string => JSON.stringify(sortedKeys(value));
