export { ask, type AskDeps } from './ask';
export { type AssembledContext, assembleContext, EMPTY_CONTEXT } from './assemble-context';
export {
  attributeSentences,
  quotesIn,
  type SentenceSlides,
  sourcesOf,
} from './attribute-sentences';
export { type ClaimSpan, claimSpans, spansOf, splitClaims } from './claims';
export {
  type BudgetedDeps,
  explain,
  type ExplainDepth,
  type ExplainDeps,
  type ExplainResult,
  type ExplainSources,
  type ExplainStage,
  type SearchSentence,
} from './explain';
export { classifySentenceKinds } from './classify-sentence-kinds';
export { type DraftUnit, type GenerationOutcome, generateUnits } from './generate-units';
export { ground, type GroundingDeps, type GroundingResult, type GroundingStage } from './ground';
export {
  contradictingSources,
  markContradictions,
  type SentencePremises,
} from './mark-contradictions';
export type { ModelFailure } from './model-failure';
export {
  type ClaimLabel,
  claimLabel,
  type EntailmentScores,
  nliVerdict,
  type NliThresholds,
  PROVISIONAL_NLI_THRESHOLDS,
} from './nli-verdict';
export { contextPremises, type Premise, scoredPremises, slidePremise } from './premise';
export {
  GeneratedUnits,
  type GenerationTask,
  generationRequest,
  LineCitation,
  type SummaryTask,
} from './prompts/generation-prompt';
export { explanationRequest, GeneratedExplanation } from './prompts/explanation-prompt';
export { rewriteRequest, RewriteReply } from './prompts/rewrite-prompt';
export { VerdictReply, verifierRequest } from './prompts/verifier-prompt';
export {
  SentenceKind,
  type SentenceKindReply,
  sentenceKindRequest,
} from './prompts/sentence-kind-prompt';
export {
  quoteResolves,
  quotesResolve,
  type Resolution,
  type ResolvedUnit,
  resolveCitations,
} from './resolve-citations';
export { type QuoteResolution, resolveQuotes } from './resolve-quotes';
export { copiedLine, copiedLines, slideLines, slideText } from './slide-text';
export {
  type FactTagging,
  lectureFacts,
  type TagDeps,
  type TagFact,
  tagFacts,
  type UntaggedReason,
} from './tag-facts';
export { TAG_MAX_CHARS, TagReply, tagRequest, TAGS_PER_FACT } from './prompts/tag-prompt';
export {
  estimateTokens,
  PROMPT_CHARS_PER_TOKEN,
  PROMPT_TOKEN_BUDGET,
  REPLY_TOKEN_RESERVE,
  requestTokens,
} from './prompt-budget';
export {
  SUMMARY_MAX_UNITS,
  digestOf,
  type SummaryDeps,
  type SummaryLecture,
  type SummaryOutcome,
  summariseLecture,
  summaryParts,
  type UnsummarisedReason,
} from './summarise-lecture';
export { type DeepDeps, type DeepVerification, verifyExplanation } from './verify-explanation';
export {
  PROVISIONAL_VERIFIER_STRATEGY,
  type VerifyDeps,
  VerifierStrategy,
  type VerifyOutcome,
  verifyStatement,
} from './verify';
export type { Quotes, VerifierInput } from './verifier-input';
