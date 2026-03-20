import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useLocalStorage } from './src/hooks/use-local-storage';

describe('useLocalStorage stale closure bug', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('updates sequentially when using functional updater with key change', () => {
    const { result, rerender } = renderHook(
      ({ key }) => useLocalStorage(key, 0),
      { initialProps: { key: 'count' } }
    );

    act(() => {
      result.current[1]((prev) => prev + 1);
    });

    rerender({ key: 'count2' });

    act(() => {
      // With a stale closure, the updater here might write to 'count' instead of 'count2'
      result.current[1]((prev) => prev + 1);
    });

    expect(Number(localStorage.getItem('count2'))).toBe(1);
  });
});
