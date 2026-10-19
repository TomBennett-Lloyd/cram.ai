import { z } from 'zod';

/** The model roles of `docs/adr/0003-model-roles-and-backends.md` § Decision (a); a feature names a role, never a model. */
export const Role = z.enum(['generator', 'verifier', 'embedder', 'reranker']);
export type Role = z.infer<typeof Role>;

export const EncoderRole = Role.exclude(['generator']);
export type EncoderRole = z.infer<typeof EncoderRole>;
