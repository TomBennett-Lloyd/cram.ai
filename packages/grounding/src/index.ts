export { ask, type AskDeps } from './ask';
export {
  attributeSentences,
  quotesIn,
  type SentenceSlides,
  sourcesOf,
} from './attribute-sentences';
export { type ClaimSpan, claimSpans, spansOf, splitClaims } from './claims';
export {
  explain,
  type ExplainDepth,
  type ExplainDeps,
  type ExplainResult,
  type ExplainStage,
  type SearchSentence,
} from './explain';
export { type DraftUnit, type GenerationOutcome, generateUnits } from './generate-units';
export { ground, type GroundingDeps, type GroundingResult, type GroundingStage } from './ground';
export { markContradictions } from './mark-contradictions';
export type { ModelFailure } from './model-failure';
export {
  type ClaimLabel,
  claimLabel,
  type EntailmentScores,
  nliVerdict,
  type NliThresholds,
  PROVISIONAL_NLI_THRESHOLDS,
} from './nli-verdict';
export {
  type AskTask,
  GeneratedUnits,
  type GenerationTask,
  generationRequest,
  LineCitation,
  SlideLineNo,
} from './prompts/generation-prompt';
export { explanationRequest, GeneratedExplanation } from './prompts/explanation-prompt';
export { rewriteRequest, RewriteReply } from './prompts/rewrite-prompt';
export { VerdictReply, verifierRequest } from './prompts/verifier-prompt';
export {
  quoteResolves,
  quotesResolve,
  type Resolution,
  type ResolvedUnit,
  resolveCitations,
} from './resolve-citations';
export { type QuoteResolution, resolveQuotes } from './resolve-quotes';
export { slideLines, slideText } from './slide-text';
export { VERIFICATION_DEPTH } from './verification-depth';
export { type DeepDeps, type DeepVerification, verifyExplanation } from './verify-explanation';
export {
  PROVISIONAL_VERIFIER_STRATEGY,
  type VerifyDeps,
  VerifierStrategy,
  type VerifyOutcome,
  verifyStatement,
} from './verify';
export type { Quotes, VerifierInput } from './verifier-input';
