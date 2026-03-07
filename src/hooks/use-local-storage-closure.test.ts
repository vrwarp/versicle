import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useLocalStorage } from './use-local-storage';

describe('useLocalStorage closure bug', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('evaluates against the correct React state parameter instead of captured closure', () => {
    const { result, rerender } = renderHook(
      ({ key }) => useLocalStorage(key, 0),
      { initialProps: { key: 'key1' } }
    );

    act(() => {
      // Simulate multiple rapid clicks
      result.current[1]((prev) => prev + 1);
      result.current[1]((prev) => prev + 1);
      result.current[1]((prev) => prev + 1);
    });

    // Should be 3
    expect(result.current[0]).toBe(3);
  });
});
