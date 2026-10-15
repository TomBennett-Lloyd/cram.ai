import { z } from 'zod';

export const NonBlankText = z.string().regex(/\S/);
