import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useLocalStorage } from './use-local-storage';

describe('useLocalStorage closure bug', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('preserves the correct state when calling setValue with a function after key change', () => {
    const { result, rerender } = renderHook(
      ({ key }) => useLocalStorage(key, 0),
      { initialProps: { key: 'key1' } }
    );

    // Initial value is 0
    expect(result.current[0]).toBe(0);

    // Update value for key1
    act(() => {
      result.current[1](10);
    });
    expect(result.current[0]).toBe(10);

    // Change key to key2
    rerender({ key: 'key2' });

    // Value should be 0 (initial for key2)
    expect(result.current[0]).toBe(0);

    // Update value using functional update
    act(() => {
      result.current[1]((prev) => prev + 1);
    });

    // If it captures the old storedValue (10) instead of currentValue (0), this will be 11
    // The correct behavior should be 1.
    expect(result.current[0]).toBe(1);
  });
});
