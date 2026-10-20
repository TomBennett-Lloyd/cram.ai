import { EmbedderPin, GeneratorPin, RerankerPin, Sampling, VerifierPin } from '@cram/gateway';
import { VerifierStrategy } from '@cram/grounding';
import { z } from 'zod';
import { CitationValidityRow } from './citation-validity';
import { ContradictionSetRow } from './contradiction-set';
import { DerivedCoverageRow } from './derived-text';
import { LatencySummary } from './latency';
import { BaselineRow, NotMeasurable } from './metric-row';
import { ArmDecision } from './verifier-arms';

/** Closed, since a baseline is per class (`docs/adr/0005-evaluation-as-gate.md` § Decision (f)); the target is #3's machine. */
export const MachineClass = z.enum(['target-cpu-laptop', 'dev-apple-silicon']);
export type MachineClass = z.infer<typeof MachineClass>;

const Probability = z.number().min(0).max(1);

const Accuracy = z.strictObject({ precision: BaselineRow, recall: BaselineRow });

const Arm = z.strictObject({
  accuracy: Accuracy,
  contradictionSet: ContradictionSetRow,
  perUnitLatency: LatencySummary,
});

/**
 * One measured run (`docs/adr/0005-evaluation-as-gate.md` § Decision (f)); pins are the ones that
 * ran, per `docs/adr/0003-model-roles-and-backends.md` § Decision (e), and `reranker` is null when
 * none was configured. The headline metrics are those of `verifierStrategy`.
 */
export const EvalReport = z.strictObject({
  measuredCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
  pullRequest: z.number().int().positive(),
  machineClass: MachineClass,
  pins: z.strictObject({
    generator: GeneratorPin,
    verifier: VerifierPin,
    embedder: EmbedderPin,
    reranker: RerankerPin.nullable(),
  }),
  determinism: z.strictObject({ generator: Sampling }),
  nliThresholds: z.strictObject({ entailedAt: Probability, contradictedAt: Probability }),
  retrievalK: z.number().int().positive(),
  verifierStrategy: VerifierStrategy,
  metrics: z.strictObject({
    citationValidity: CitationValidityRow,
    contradictionSet: ContradictionSetRow,
    retrievalRecall: BaselineRow,
    verifierPrecision: BaselineRow,
    verifierRecall: BaselineRow,
    examAnswerability: BaselineRow,
    gradingAgreement: BaselineRow,
    derivedTextCoverage: DerivedCoverageRow,
    derivedTextRecall: BaselineRow,
    derivedTextPrecision: BaselineRow,
  }),
  verifierArms: z.strictObject({
    nli: Arm,
    llm: Arm.omit({ contradictionSet: true }),
    nliThenLlm: Arm,
    crossEncoderPrimary: ArmDecision,
    secondOpinion: ArmDecision,
  }),
  latency: z.strictObject({
    ask: LatencySummary,
    perCall: z.strictObject({
      generator: LatencySummary,
      verifier: LatencySummary,
      embedder: LatencySummary,
      reranker: LatencySummary,
    }),
    generatorTimeToFirstToken: NotMeasurable,
    generatorTokensPerSecond: NotMeasurable,
  }),
});
export type EvalReport = z.infer<typeof EvalReport>;
