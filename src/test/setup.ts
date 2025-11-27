import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Polyfill ResizeObserver
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserver;

// Polyfill ScrollTo
window.scrollTo = vi.fn();

afterEach(() => {
  cleanup();
});
