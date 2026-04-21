import React from 'react';
import { render, act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useLocalStorage } from './use-local-storage';

describe('useLocalStorage cross-hook sync', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('updates stateRef synchronously when receiving custom event', async () => {
    const { result: hook1 } = renderHook(() => useLocalStorage('test-key', 0));
    const { result: hook2 } = renderHook(() => useLocalStorage('test-key', 0));

    act(() => {
      hook1.current[1](1);
    });

    // Wait for setTimeout to dispatch the custom event
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // hook2 should now be updated
    expect(hook2.current[0]).toBe(1);

    // Now if hook2 uses a functional update, it should base it on the NEW value
    act(() => {
      hook2.current[1](prev => prev + 1);
    });

    expect(hook2.current[0]).toBe(2);
    expect(localStorage.getItem('test-key')).toBe('2');
  });
});
