/** The damping constant Cormack, Clarke and Büttcher (SIGIR 2009) use. */
export const RRF_K = 60;

export interface RankedList<Id> {
  readonly ids: readonly Id[];
  readonly weight: number;
}

/** Weighted reciprocal rank fusion (`docs/adr/0004-storage.md` § Decision (c)); ties keep first appearance. */
export const fuseByReciprocalRank = <Id>(
  lists: readonly RankedList<Id>[],
  rrfK: number = RRF_K,
): readonly Id[] => {
  const scores = new Map<Id, number>();
  for (const { ids, weight } of lists) {
    if (!(Number.isFinite(weight) && weight > 0)) {
      throw new Error(
        `fuseByReciprocalRank: a list's weight must be positive, got ${String(weight)}`,
      );
    }
    if (new Set(ids).size !== ids.length) {
      throw new Error('fuseByReciprocalRank: a ranked list holds the same id twice');
    }
    ids.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + weight / (rrfK + index + 1));
    });
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
};
