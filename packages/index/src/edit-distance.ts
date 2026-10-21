/** A string's code points, the unit SQLite's `length()` counts. */
export const codePoints = (text: string): readonly string[] => Array.from(text);

/** Optimal string alignment distance over code points: a swap of two adjacent letters is one edit, as a typo is (#393). */
export const editDistance = (from: string, to: string): number => {
  const a = codePoints(from);
  const b = codePoints(to);
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  const at = (i: number, j: number): number => rows[i]?.[j] ?? Number.POSITIVE_INFINITY;
  for (let i = 1; i <= a.length; i += 1) {
    const row = rows[i] ?? [];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + substitution);
      if (a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        best = Math.min(best, at(i - 2, j - 2) + 1);
      row[j] = best;
    }
  }
  return at(a.length, b.length);
};
