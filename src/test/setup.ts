import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Mock window.speechSynthesis
Object.defineProperty(window, 'speechSynthesis', {
  value: {
    getVoices: vi.fn().mockReturnValue([]),
    speak: vi.fn(),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    onvoiceschanged: null,
    speaking: false,
    paused: false,
    pending: false
  },
  writable: true
});

// Mock SpeechSynthesisUtterance
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).SpeechSynthesisUtterance = vi.fn().mockImplementation(() => ({
  text: '',
  voice: null,
  rate: 1,
  onstart: null,
  onend: null,
  onerror: null,
}));

// Mock URL.createObjectURL/revokeObjectURL
global.URL.createObjectURL = vi.fn(() => 'blob:url');
global.URL.revokeObjectURL = vi.fn();

// Mock ResizeObserver
global.ResizeObserver = class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};

// Mock Pointer Capture methods for JSDOM environment
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (!Element.prototype.setPointerCapture) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Element.prototype as any).setPointerCapture = vi.fn();
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (!Element.prototype.releasePointerCapture) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Element.prototype as any).releasePointerCapture = vi.fn();
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
