import type { ChatResult } from '@cram/gateway';

export type ModelFailure = Exclude<ChatResult<unknown>, { readonly status: 'completed' }>;
