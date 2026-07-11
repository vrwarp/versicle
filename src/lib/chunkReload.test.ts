import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isChunkLoadError, reloadOnceForChunkError, importWithChunkReload } from './chunkReload';

const reloadSpy = vi.fn();

beforeEach(() => {
  sessionStorage.clear();
  reloadSpy.mockClear();
  // jsdom's location.reload throws "Not implemented"; replace it wholesale.
  vi.stubGlobal('location', { ...window.location, reload: reloadSpy });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isChunkLoadError', () => {
  it('matches the WebKit dynamic-import failure message', () => {
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
  });

  it('matches the Chromium dynamic-import failure message', () => {
    expect(
      isChunkLoadError(
        new TypeError('Failed to fetch dynamically imported module: http://x/assets/ReaderShell-abc.js'),
      ),
    ).toBe(true);
  });

  it('matches the Firefox dynamic-import failure message', () => {
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
  });

  it('rejects unrelated errors and non-errors', () => {
    expect(isChunkLoadError(new Error('WorkspaceDeletedError: gone'))).toBe(false);
    expect(isChunkLoadError('Importing a module script failed.')).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('reloadOnceForChunkError', () => {
  it('reloads on the first failure', () => {
    expect(reloadOnceForChunkError('reader-shell')).toBe(true);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('refuses a second reload inside the guard window (no reload loop)', () => {
    expect(reloadOnceForChunkError('reader-shell')).toBe(true);
    expect(reloadOnceForChunkError('reader-shell')).toBe(false);
    expect(reloadOnceForChunkError('settings-shell')).toBe(false); // window is global, not per-scope
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('reloads again once the guard window has elapsed', () => {
    vi.useFakeTimers();
    try {
      expect(reloadOnceForChunkError('boot')).toBe(true);
      vi.advanceTimersByTime(61_000);
      expect(reloadOnceForChunkError('boot')).toBe(true);
      expect(reloadSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('importWithChunkReload', () => {
  it('passes a successful import through untouched', async () => {
    const importer = importWithChunkReload(() => Promise.resolve({ default: 'ok' }), 'x');
    await expect(importer()).resolves.toEqual({ default: 'ok' });
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('reloads and stays pending on a chunk-load failure', async () => {
    const importer = importWithChunkReload(
      () => Promise.reject(new TypeError('Importing a module script failed.')),
      'reader-shell',
    );
    let settled = false;
    void importer().finally(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false); // Suspense keeps its fallback while the reload lands
  });

  it('rethrows a chunk-load failure when the reload guard is exhausted', async () => {
    reloadOnceForChunkError('warm-up'); // consume the window
    reloadSpy.mockClear();
    const importer = importWithChunkReload(
      () => Promise.reject(new TypeError('Importing a module script failed.')),
      'reader-shell',
    );
    await expect(importer()).rejects.toThrow('Importing a module script failed.');
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('rethrows non-chunk errors without reloading', async () => {
    const importer = importWithChunkReload(() => Promise.reject(new Error('boom')), 'x');
    await expect(importer()).rejects.toThrow('boom');
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});
