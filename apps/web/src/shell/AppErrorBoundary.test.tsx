import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { APP_FAILED } from '../copy';
import { AppErrorBoundary } from './AppErrorBoundary';

const Throws = (): never => {
  throw new Error('render bug');
};

describe('AppErrorBoundary', () => {
  it('shows the labelled failure for a render throw', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <AppErrorBoundary>
        <Throws />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toBe(APP_FAILED);
    vi.restoreAllMocks();
  });

  it('shows the same failure for a rejection nobody awaited, and stops listening once unmounted', () => {
    const view = render(
      <AppErrorBoundary>
        <p>app</p>
      </AppErrorBoundary>,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => {
      window.dispatchEvent(new Event('unhandledrejection'));
    });
    expect(screen.getByRole('alert').textContent).toBe(APP_FAILED);
    const spy = vi.spyOn(window, 'removeEventListener');
    view.unmount();
    expect(spy.mock.calls.map(([type]) => type)).toContain('unhandledrejection');
    spy.mockRestore();
  });
});
