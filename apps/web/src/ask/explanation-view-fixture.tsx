import {
  type Explanation,
  type RetrievedSlide,
  SourceId,
  type VerificationDepth,
} from '@cram/shared';
import { render } from '@testing-library/react';
import { GROUNDED } from '../api/api-fixture';
import { ExplanationView } from './ExplanationView';

export const id = (value: string) => SourceId.parse(value);

interface Shown {
  readonly depth?: VerificationDepth;
  readonly slides?: readonly RetrievedSlide[];
}

export const show = (
  explanation: Explanation,
  { depth = 'light', slides = GROUNDED.slides }: Shown = {},
) =>
  render(
    <ExplanationView
      explanation={explanation}
      slides={slides}
      depth={depth}
      onOpen={() => undefined}
    />,
  ).container;

/** Each reference button's visible number and accessible name, in document order. */
export const refsIn = (scope: Element) =>
  [...scope.querySelectorAll('.source-ref')].map((ref) => [
    ref.textContent,
    ref.getAttribute('aria-label'),
  ]);
