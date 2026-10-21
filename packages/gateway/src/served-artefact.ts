import { z } from 'zod';

/** Whether the server was seen serving the pin's weights; its template and parameters are #335's gap. */
export const ServedArtefact = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('verified') }),
  z.strictObject({ status: z.literal('unverified'), reason: z.string().regex(/\S/) }),
]);
export type ServedArtefact = z.infer<typeof ServedArtefact>;
