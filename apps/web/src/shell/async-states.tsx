import type { ReactNode } from 'react';
import { DISMISS, RETRY } from '../copy';

/** A message the reader can say they have read; `onDismiss` is absent while a dismissal is under way. */
export interface Dismissible {
  readonly message: string;
  readonly onDismiss: (() => void) | undefined;
}

/** A visible label in an `aria-busy` container, never a live region (`docs/standards/react.md` § Async surface convention). */
export const Pending = ({ label }: { readonly label: string }) => (
  <div className="pending" aria-busy="true">
    <p>{label}</p>
  </div>
);

export const Failed = ({
  messages,
  dismissible,
  onRetry,
}: {
  readonly messages: readonly string[];
  readonly dismissible?: Dismissible | undefined;
  readonly onRetry?: (() => void) | undefined;
}) => (
  <div className="failed" role="alert">
    {messages.map((message, index) => (
      <p key={index}>{message}</p>
    ))}
    {dismissible !== undefined && (
      <>
        <p>{dismissible.message}</p>
        <button
          type="button"
          aria-disabled={dismissible.onDismiss === undefined}
          onClick={dismissible.onDismiss}
        >
          {DISMISS}
        </button>
      </>
    )}
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
