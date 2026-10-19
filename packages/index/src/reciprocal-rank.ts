/** The damping constant Cormack, Clarke and Büttcher (SIGIR 2009) use. */
export const RRF_K = 60;

/** Reciprocal rank fusion of best-first lists (`docs/adr/0004-storage.md` § Decision (c)); ties keep first appearance. */
export const fuseByReciprocalRank = <Id>(
  lists: readonly (readonly Id[])[],
  rrfK: number = RRF_K,
): readonly Id[] => {
  const scores = new Map<Id, number>();
  for (const list of lists) {
    if (new Set(list).size !== list.length) {
      throw new Error('fuseByReciprocalRank: a ranked list holds the same id twice');
    }
    list.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (rrfK + index + 1));
    });
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
};
