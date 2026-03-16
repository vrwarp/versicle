import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useLocalStorage } from './src/hooks/use-local-storage';

describe('useLocalStorage stale closure bug2', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('preserves referential equality of setter', () => {
    const { result, rerender } = renderHook(
      ({ key }) => useLocalStorage(key, 0),
      { initialProps: { key: 'count' } }
    );

    const firstSetter = result.current[1];

    rerender({ key: 'count2' });

    const secondSetter = result.current[1];

    // the setter gets re-created on every render right now,
    // which breaks useCallback dependencies
    expect(firstSetter).toBe(secondSetter);
  });
});
