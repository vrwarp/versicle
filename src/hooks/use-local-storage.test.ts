import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useLocalStorage } from './use-local-storage';

describe('useLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('updates sequentially when using functional updater', () => {
    const { result } = renderHook(() => useLocalStorage('count', 0));

    act(() => {
      result.current[1]((prev) => prev + 1);
      result.current[1]((prev) => prev + 1);
    });

    expect(result.current[0]).toBe(2);
    expect(Number(localStorage.getItem('count'))).toBe(2);
  });
});
