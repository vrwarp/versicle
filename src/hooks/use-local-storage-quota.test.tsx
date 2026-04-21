import React from 'react';
import { render, act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useLocalStorage } from './use-local-storage';

describe('useLocalStorage quota exceeded', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles QuotaExceededError when setting item', () => {
    const originalSetItem = window.localStorage.setItem;

    // Mock setItem to throw QuotaExceededError
    vi.spyOn(window.localStorage, 'setItem').mockImplementation((key, value) => {
      const err = new DOMException('QuotaExceededError', 'QuotaExceededError');
      throw err;
    });

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Mock Promise.reject to prevent unhandled rejection failing vitest
    const rejectSpy = vi.spyOn(Promise, 'reject').mockImplementation(() => new Promise(() => {}) as any);

    // Mock setTimeout to ensure it executes synchronously for the mock catch
    vi.useFakeTimers();

    const { result } = renderHook(() => useLocalStorage('test-key', 'initial'));

    act(() => {
      result.current[1]('new-value');
    });

    // Fast-forward to trigger the setTimeout in our catch block
    act(() => {
        vi.runAllTimers();
    });

    // value should still be updated in memory even if it couldn't be saved to local storage
    expect(result.current[0]).toBe('new-value');

    // warning should be logged
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Error setting localStorage key "test-key":',
      expect.any(DOMException)
    );

    window.localStorage.setItem = originalSetItem;
    vi.useRealTimers();
  });
});
