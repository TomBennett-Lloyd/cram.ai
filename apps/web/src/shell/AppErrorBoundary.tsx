import { Component, type ReactNode } from 'react';
import { APP_FAILED } from '../copy';
import { Failed } from './async-states';

interface BoundaryState {
  readonly failed: boolean;
}

/**
 * A render throw and a rejection nobody awaited get the same labelled failure, never a silent hang
 * (`docs/standards/react.md` § Async surface convention). A class because React offers no hook for it.
 */
export class AppErrorBoundary extends Component<{ readonly children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  readonly #onRejection = (): void => {
    this.setState({ failed: true });
  };

  override componentDidMount(): void {
    window.addEventListener('unhandledrejection', this.#onRejection);
  }

  override componentWillUnmount(): void {
    window.removeEventListener('unhandledrejection', this.#onRejection);
  }

  override render(): ReactNode {
    return this.state.failed ? <Failed messages={[APP_FAILED]} /> : this.props.children;
  }
}
