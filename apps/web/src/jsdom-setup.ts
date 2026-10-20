import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/** jsdom has no modal dialog; the browser lane (`e2e/`) holds the real one. Node-environment files have no DOM. */
if ('HTMLDialogElement' in globalThis)
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };

afterEach(cleanup);
