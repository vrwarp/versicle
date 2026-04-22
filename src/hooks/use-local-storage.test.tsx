import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useLocalStorage } from './use-local-storage';
import { StorageFullError } from '../types/errors';

describe('useLocalStorage error dispatching', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
     vi.restoreAllMocks();
  });

  it('triggers an unhandled promise rejection with StorageFullError on QuotaExceededError', async () => {
    const originalSetItem = window.localStorage.setItem;

    // Mock setItem to throw QuotaExceededError
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      const err = new DOMException('QuotaExceededError', 'QuotaExceededError');
      throw err;
    });

    // Mock setTimeout so we can execute the promise rejection synchronously
    vi.useFakeTimers();

    const { result } = renderHook(() => useLocalStorage('test-key', 'initial'));

    act(() => {
      result.current[1]('new-value');
    });

    // We can't nicely assert on an unhandled rejection without vitest failing.
    // Instead of asserting on the event itself, we verify that Promise.reject is called with StorageFullError
    const promiseRejectSpy = vi.spyOn(Promise, 'reject').mockImplementation(() => {
        // Mock to prevent actual unhandled rejection that fails the test runner
        return new Promise(() => {}) as Promise<never>;
    });

    // Fast-forward to trigger the setTimeout in our catch block
    act(() => {
        vi.runAllTimers();
    });

    expect(promiseRejectSpy).toHaveBeenCalledWith(
        expect.any(StorageFullError)
    );

    // Clean up
    window.localStorage.setItem = originalSetItem;
    vi.useRealTimers();
  });
});
