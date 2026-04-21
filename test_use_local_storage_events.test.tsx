import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { useLocalStorage } from './src/hooks/use-local-storage';

function TestComponent({storageKey}) {
  const [val, setVal] = useLocalStorage(storageKey, 'default');

  return (
    <div>
      <div data-testid="val">{val}</div>
      <button onClick={() => setVal('new')} data-testid="btn">set</button>
      <button onClick={() => setVal(prev => prev + '-updated')} data-testid="btn-update">update</button>
    </div>
  );
}

test('useLocalStorage listens to other tabs updates', () => {
  render(<TestComponent storageKey="k1" />);
  expect(screen.getByTestId('val').textContent).toBe('default');

  act(() => {
    window.localStorage.setItem('k1', '"from_other_tab"');
    window.dispatchEvent(new StorageEvent('storage', { key: 'k1', newValue: '"from_other_tab"' }));
  });

  expect(screen.getByTestId('val').textContent).toBe('from_other_tab');
});
