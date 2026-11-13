import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { captureError, initAnalytics } from './lib/analytics';
import './index.css';

initAnalytics();

createRoot(document.getElementById('root')!, {
  // A render error that unmounts the app: logged as React does by default,
  // and sent with the component stack (React no longer reports it to window).
  onUncaughtError: (error, info) => {
    console.error(error);
    captureError(error, { source: 'react', componentStack: info.componentStack ?? null });
  },
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
