import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';
import { vi } from 'vitest';

// Mock Media Element
window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
window.HTMLMediaElement.prototype.pause = vi.fn();
window.HTMLMediaElement.prototype.load = vi.fn();
window.HTMLAudioElement.prototype.play = vi.fn().mockResolvedValue(undefined);
window.HTMLAudioElement.prototype.pause = vi.fn();

// Polyfill Blob.text
if (!Blob.prototype.text) {
  Blob.prototype.text = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(this);
    });
  };
}

if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(this);
    });
  };
}

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    length: 0,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    key: (_index: number) => null,
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true
});

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
window.ResizeObserver = class ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};

// Mock SpeechSynthesis
Object.defineProperty(window, 'speechSynthesis', {
  value: {
    speak: vi.fn(),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: vi.fn().mockReturnValue([]),
    onvoiceschanged: null
  },
  writable: true
});
Object.defineProperty(window, 'SpeechSynthesisUtterance', {
  value: vi.fn(),
  writable: true
});

// Console suppression system for tests
// Captures console.error and console.warn during tests
// Only prints them if the test fails or if VERBOSE=1 is set
import { beforeEach, afterEach } from 'vitest';

const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleLog = console.log;
const originalConsoleInfo = console.info;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let capturedLogs: { type: 'error' | 'warn' | 'log' | 'info', args: any[] }[] = [];

const isVerbose = process.env.VERBOSE === '1' || process.env.VERBOSE === 'true';

beforeEach(() => {
  capturedLogs = [];
  if (!isVerbose) {
    console.error = (...args) => capturedLogs.push({ type: 'error', args });
    console.warn = (...args) => capturedLogs.push({ type: 'warn', args });
    console.log = (...args) => capturedLogs.push({ type: 'log', args });
    console.info = (...args) => capturedLogs.push({ type: 'info', args });
  }
});

afterEach(({ task }) => {
  if (!isVerbose) {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    console.log = originalConsoleLog;
    console.info = originalConsoleInfo;

    // task.result?.state will be 'fail' if the test threw an error
    if (task.result?.state === 'fail' && capturedLogs.length > 0) {
      originalConsoleError('\n--- Captured Console Output for Failed Test ---');
      for (const log of capturedLogs) {
        if (log.type === 'error') originalConsoleError(...log.args);
        else if (log.type === 'warn') originalConsoleWarn(...log.args);
        else if (log.type === 'log') originalConsoleLog(...log.args);
        else if (log.type === 'info') originalConsoleInfo(...log.args);
      }
      originalConsoleError('-----------------------------------------------\n');
    }
  }
});
