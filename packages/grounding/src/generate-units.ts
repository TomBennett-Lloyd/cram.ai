import type { Generator } from '@cram/gateway';
import type { RetrievedSlide, Unit } from '@cram/shared';
import type { ModelFailure } from './model-failure';
import { type GenerationTask, generationRequest } from './prompts/generation-prompt';

export type GenerationOutcome =
  | { readonly status: 'generated'; readonly units: readonly Unit[] }
  | { readonly status: 'model-failed'; readonly failure: ModelFailure };

/** The task fixes each unit's kind; the model writes only text and citations. */
export const generateUnits = async (
  task: GenerationTask,
  slides: readonly RetrievedSlide[],
  generator: Generator,
): Promise<GenerationOutcome> => {
  const result = await generator.chat(generationRequest(task, slides));
  if (result.status !== 'completed') return { status: 'model-failed', failure: result };
  return {
    status: 'generated',
    units: result.value.units.map((unit) => ({ ...unit, kind: task.kind })),
  };
};
