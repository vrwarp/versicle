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
class MockSpeechSynthesisUtterance {
  text: string;
  voice: SpeechSynthesisVoice | null = null;
  rate: number = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: any) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}
(global as any).SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;

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
  Object.defineProperty(Blob.prototype, 'text', {
    value: function() {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsText(this);
      });
    },
    writable: true,
    configurable: true,
    enumerable: false // Important for IDB cloning
  });
}

// Polyfill Blob.prototype.arrayBuffer
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function() {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(this);
    });
  };
}

// Polyfill File.prototype.text (File inherits from Blob but sometimes needs explicit help in JSDOM)
if (typeof File !== 'undefined' && !File.prototype.text) {
  // Use Blob.prototype.text directly if available, or define similarly
  Object.defineProperty(File.prototype, 'text', {
    value: Blob.prototype.text,
    writable: true,
    configurable: true,
    enumerable: false // Important for IDB cloning
  });
}
if (typeof File !== 'undefined' && !File.prototype.arrayBuffer) {
  File.prototype.arrayBuffer = Blob.prototype.arrayBuffer;
}

// Also check for arrayBuffer on File prototype in JSDOM
if (typeof File !== 'undefined' && !File.prototype.arrayBuffer) {
    Object.defineProperty(File.prototype, 'arrayBuffer', {
        value: function() {
             return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as ArrayBuffer);
                reader.onerror = reject;
                reader.readAsArrayBuffer(this);
             });
        },
        writable: true,
        configurable: true,
        enumerable: false
    });
}


afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
