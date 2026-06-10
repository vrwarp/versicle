import { render, screen, renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useLocalStorage } from './use-local-storage';

// Cross-tab sync: a StorageEvent (fired when ANOTHER tab writes localStorage)
// must update hooks in this tab. Same-tab sync via the custom event is covered
// separately in use-local-storage-sync.test.tsx.
describe('useLocalStorage other-tab StorageEvent sync', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('updates when another tab changes localStorage', () => {
    const { result } = renderHook(() => useLocalStorage('count', 0));

    expect(result.current[0]).toBe(0);

    act(() => {
      localStorage.setItem('count', '5');
      window.dispatchEvent(new StorageEvent('storage', { key: 'count', newValue: '5' }));
    });

    expect(result.current[0]).toBe(5);
  });

  it('re-renders a consuming component on a StorageEvent', () => {
    function TestComponent({ storageKey }: { storageKey: string }) {
      const [val] = useLocalStorage(storageKey, 'default');
      return <div data-testid="val">{val}</div>;
    }

    render(<TestComponent storageKey="k1" />);
    expect(screen.getByTestId('val').textContent).toBe('default');

    act(() => {
      window.localStorage.setItem('k1', '"from_other_tab"');
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'k1', newValue: '"from_other_tab"' })
      );
    });

    expect(screen.getByTestId('val').textContent).toBe('from_other_tab');
  });
});
