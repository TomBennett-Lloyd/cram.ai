import type { ReactNode } from 'react';

/**
 * The folded panel that is the one place withheld text appears, never styled as the answer
 * (`docs/standards/grounding.md` rule 7); `onOpen` runs each time it is opened.
 */
export const WithheldDetails = ({
  count,
  onOpen,
  children,
}: {
  readonly count: number;
  readonly onOpen?: (() => void) | undefined;
  readonly children: ReactNode;
}) => (
  <details
    className="withheld"
    onToggle={(event) => {
      if (event.currentTarget.open) onOpen?.();
    }}
  >
    <summary>Withheld ({count})</summary>
    {children}
  </details>
);

export const WithheldItem = ({
  text,
  reason,
  children,
}: {
  readonly text: string;
  readonly reason: string;
  readonly children?: ReactNode;
}) => (
  <li>
    <p className="withheld-text">{text}</p>
    <p className="withheld-reason">{reason}</p>
    {children}
  </li>
);
