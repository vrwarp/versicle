import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useLocalStorage } from './use-local-storage';

describe('useLocalStorage predictability bug', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('updates sequentially when using functional updater', () => {
    const { result } = renderHook(() => useLocalStorage('count', 0));

    // Update twice in the same render cycle
    act(() => {
      result.current[1]((prev) => prev + 1);
      result.current[1]((prev) => prev + 1);
    });

    // Should be 2, but will likely be 1 if it uses the stale closure currentValue
    expect(result.current[0]).toBe(2);
    expect(Number(localStorage.getItem('count'))).toBe(2);
  });
});
