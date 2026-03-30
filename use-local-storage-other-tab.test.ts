import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useLocalStorage } from './src/hooks/use-local-storage';

describe('useLocalStorage other tab sync', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('updates when other tab changes localStorage', () => {
    const { result } = renderHook(() => useLocalStorage('count', 0));

    expect(result.current[0]).toBe(0);

    act(() => {
      localStorage.setItem('count', '5');
      window.dispatchEvent(new StorageEvent('storage', { key: 'count', newValue: '5' }));
    });

    expect(result.current[0]).toBe(5);
  });
});
