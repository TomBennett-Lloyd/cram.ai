import type { ReactNode } from 'react';
import { RETRY } from '../copy';

/** A visible label in an `aria-busy` container, never a live region (`docs/standards/react.md` § Async surface convention). */
export const Pending = ({ label }: { readonly label: string }) => (
  <div className="pending" aria-busy="true">
    <p>{label}</p>
  </div>
);

/**
 * Mounted in answer to something, so the alert is a change and is announced. One per panel: every
 * message the panel owes goes in it, with a retry only where retrying can work.
 */
export const Failed = ({
  messages,
  onRetry,
}: {
  readonly messages: readonly string[];
  readonly onRetry?: (() => void) | undefined;
}) => (
  <div className="failed" role="alert">
    {messages.map((message, index) => (
      <p key={index}>{message}</p>
    ))}
    {onRetry !== undefined && (
      <button type="button" onClick={onRetry}>
        {RETRY}
      </button>
    )}
  </div>
);

export const Empty = ({ children }: { readonly children: ReactNode }) => (
  <p className="empty">{children}</p>
);
