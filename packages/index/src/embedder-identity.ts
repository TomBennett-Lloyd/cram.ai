import { z } from 'zod';

/** The embedder behind a course file's vectors (`docs/adr/0004-storage.md` § Decision (c)); `model` is opaque. */
export const EmbedderIdentity = z.object({
  model: z.string().regex(/\S/),
  dimension: z.number().int().positive(),
});
export type EmbedderIdentity = z.infer<typeof EmbedderIdentity>;

export const sameEmbedder = (a: EmbedderIdentity, b: EmbedderIdentity): boolean =>
  a.model === b.model && a.dimension === b.dimension;
