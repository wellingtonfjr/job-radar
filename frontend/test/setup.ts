import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { setLocale } from '../src/i18n';

// jsdom doesn't implement scrolling.
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

// Tests run in English unless they switch language themselves.
beforeEach(() => {
  setLocale('en');
});

afterEach(() => {
  cleanup();
});
