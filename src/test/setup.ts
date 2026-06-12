import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';
import { vi } from 'vitest';

// A few suites run in the node environment (e.g. the emulator-backed
// security-rules suite, via `@vitest-environment node`), where no DOM globals
// exist — all browser shims below only apply to jsdom suites.
if (typeof window !== 'undefined') {
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

  // ── fake-indexeddb realm fix ───────────────────────────────────────────────
  // fake-indexeddb (imported above via 'fake-indexeddb/auto') clones every
  // stored/retrieved value with the GLOBAL `structuredClone`, which under
  // vitest's jsdom environment is Node's implementation — so values read back
  // from IndexedDB are Node-realm ArrayBuffer/typed-array instances that fail
  // `instanceof ArrayBuffer` checks in app code (which sees jsdom-realm
  // intrinsics). Real browsers are single-realm, so production never hits
  // this; without the fix, prod branches like
  // BackupService.toBackupManifestRow (cover → base64) and
  // bookContent.getTableImages (ArrayBuffer → Blob normalization) silently take
  // the wrong path in any test that uses real fake-indexeddb rows.
  // The wrapper rebuilds binary containers (and the plain structures holding
  // them) in the jsdom realm after the native clone. fake-indexeddb resolves
  // `structuredClone` from the global at call time, so patching here is
  // sufficient.
  if (typeof globalThis.structuredClone === 'function') {
    const nativeStructuredClone = globalThis.structuredClone.bind(globalThis);
    const tagOf = (value: unknown) => Object.prototype.toString.call(value);

    const reRealm = (value: unknown, seen: Map<object, unknown>): unknown => {
      if (value === null || typeof value !== 'object') return value;
      const asObject = value as object;
      if (seen.has(asObject)) return seen.get(asObject);

      if (tagOf(value) === '[object ArrayBuffer]') {
        const source = new Uint8Array(value as ArrayBuffer);
        const copy = new ArrayBuffer(source.byteLength);
        new Uint8Array(copy).set(source);
        seen.set(asObject, copy);
        return copy;
      }

      if (ArrayBuffer.isView(value)) {
        const view = value as ArrayBufferView;
        const ctorName = (view.constructor as { name?: string } | undefined)?.name ?? '';
        const LocalCtor = (globalThis as unknown as Record<string, unknown>)[ctorName] as
          | (new (buffer: ArrayBuffer, byteOffset: number, length?: number) => ArrayBufferView)
          | undefined;
        if (!LocalCtor) return value;
        const buffer = reRealm(view.buffer, seen) as ArrayBuffer;
        const copy =
          tagOf(value) === '[object DataView]'
            ? new LocalCtor(buffer, view.byteOffset, view.byteLength)
            : new LocalCtor(
                buffer,
                view.byteOffset,
                (view as unknown as { length: number }).length,
              );
        seen.set(asObject, copy);
        return copy;
      }

      if (Array.isArray(value)) {
        const copy: unknown[] = [];
        seen.set(asObject, copy);
        for (const item of value) copy.push(reRealm(item, seen));
        return copy;
      }

      if (tagOf(value) === '[object Map]') {
        const copy = new Map<unknown, unknown>();
        seen.set(asObject, copy);
        for (const [k, v] of value as Map<unknown, unknown>) {
          copy.set(reRealm(k, seen), reRealm(v, seen));
        }
        return copy;
      }

      if (tagOf(value) === '[object Set]') {
        const copy = new Set<unknown>();
        seen.set(asObject, copy);
        for (const item of value as Set<unknown>) copy.add(reRealm(item, seen));
        return copy;
      }

      if (tagOf(value) === '[object Object]') {
        const copy: Record<string, unknown> = {};
        seen.set(asObject, copy);
        for (const [k, v] of Object.entries(value)) copy[k] = reRealm(v, seen);
        return copy;
      }

      // Date, RegExp, Blob, File, errors, … keep the native clone.
      return value;
    };

    globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) =>
      reRealm(nativeStructuredClone(value, options), new Map())) as typeof structuredClone;
  }
}
