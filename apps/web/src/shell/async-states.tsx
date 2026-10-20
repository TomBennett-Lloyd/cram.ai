import type { ReactNode } from 'react';

/** A visible label in an `aria-busy` container, never a live region (`docs/standards/react.md` § Async surface convention). */
export const Pending = ({ label }: { readonly label: string }) => (
  <div className="pending" aria-busy="true">
    <p>{label}</p>
  </div>
);

/** Mounted in answer to something, so the alert is a change and is announced. */
export const Failed = ({ message }: { readonly message: string }) => (
  <p className="failed" role="alert">
    {message}
  </p>
);

export const Empty = ({ children }: { readonly children: ReactNode }) => (
  <p className="empty">{children}</p>
);
