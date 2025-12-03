import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Mock window.speechSynthesis
Object.defineProperty(window, 'speechSynthesis', {
  value: {
    getVoices: vi.fn().mockReturnValue([
      { name: 'Google US English', lang: 'en-US', default: true },
      { name: 'Google UK English Female', lang: 'en-GB', default: false },
      { name: 'Google Español', lang: 'es-ES', default: false }
    ]),
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

// Mock HTMLMediaElement methods
Object.defineProperty(global.window.HTMLMediaElement.prototype, 'play', {
  configurable: true,
  value: vi.fn().mockResolvedValue(undefined),
});
Object.defineProperty(global.window.HTMLMediaElement.prototype, 'pause', {
  configurable: true,
  value: vi.fn(),
});
Object.defineProperty(global.window.HTMLMediaElement.prototype, 'load', {
  configurable: true,
  value: vi.fn(),
});

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

// Polyfill Blob.prototype.text for JSDOM 20+ which might still lack it or if env issues
if (!Blob.prototype.text) {
  Blob.prototype.text = function() {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(this);
    });
  };
}

// Polyfill File.prototype.text (File inherits from Blob but sometimes needs explicit help in JSDOM)
if (typeof File !== 'undefined' && !File.prototype.text) {
  File.prototype.text = Blob.prototype.text;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
