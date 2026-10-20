import '@cram/ui/styles.css';
import './app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiClient } from './api/api-client';
import { ApiContext } from './api/api-context';
import { App } from './App';
import { AppErrorBoundary } from './shell/AppErrorBoundary';
import { syncTheme } from './theme';

const container = document.getElementById('root');
if (container === null) throw new Error('main: index.html has no #root element');

syncTheme(document.documentElement, window.matchMedia('(prefers-color-scheme: dark)'));

const api = new ApiClient((request) => fetch(request));

createRoot(container).render(
  <StrictMode>
    <AppErrorBoundary>
      <ApiContext value={api}>
        <App />
      </ApiContext>
    </AppErrorBoundary>
  </StrictMode>,
);
