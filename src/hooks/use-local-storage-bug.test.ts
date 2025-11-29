import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useLocalStorage } from './use-local-storage';

describe('useLocalStorage bug reproduction', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should update value when key changes', () => {
    localStorage.setItem('key1', JSON.stringify('value1'));
    localStorage.setItem('key2', JSON.stringify('value2'));

    const { result, rerender } = renderHook(
      ({ key }) => useLocalStorage(key, 'default'),
      { initialProps: { key: 'key1' } }
    );

    expect(result.current[0]).toBe('value1');

    // Change the key
    rerender({ key: 'key2' });

    // This checks if the value updated to the new key's value
    expect(result.current[0]).toBe('value2');
  });
});
