import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';

// A generic way to broadcast local storage changes on the same tab
const LOCAL_STORAGE_CHANGE_EVENT = 'local-storage-change';

// Polyfill for SSR
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * A custom React hook for persisting state to localStorage.
 * Syncs the state with the browser's localStorage, allowing data to persist across reloads.
 *
 * @template T The type of the value being stored.
 * @param key - The key under which the value is stored in localStorage.
 * @param initialValue - The initial value to use if no value is found in localStorage.
 * @returns A tuple containing the current value and a setter function, similar to `useState`.
 */
export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] {
  // We use a ref for the key to avoid stale closures inside our memoized setter
  const keyRef = useRef(key);



  // We parse stored json or return initialValue
  const readValue = useCallback((): T => {
    if (typeof window === 'undefined') {
      return initialValue;
    }

    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  }, [key, initialValue]);

  // Read the initial state
  const [storedValue, setStoredValue] = useState<T>(readValue);

  // When the key changes, we need to immediately update the stored value state
  // (we do it during render, mimicking the original implementation's behavior for sync updates)
  const [prevKey, setPrevKey] = useState<string>(key);
  let currentValue = storedValue;
  if (key !== prevKey) {
    currentValue = readValue();
    setPrevKey(key);
    setStoredValue(currentValue);
  }

  // We use a stateRef to accumulate sequential synchronous calls to setter
  const stateRef = useRef(currentValue);

  // Safely update refs after render to maintain concurrent mode predictability
  // using useLayoutEffect ensures it's updated synchronously before browser paint
  // and before any subsequent user actions
  useIsomorphicLayoutEffect(() => {
    keyRef.current = key;
    stateRef.current = currentValue;
  }, [key, currentValue]);

  // Subscribe to changes to localStorage so that this state reflects updates from:
  // 1. Other browser tabs (StorageEvent)
  // 2. Other hook instances on the same page (CustomEvent)

  useEffect(() => {
    const handleStorageChange = (e: Event) => {
      if (e instanceof StorageEvent) {
        if (e.key === key) {
          try {
            setStoredValue(e.newValue ? JSON.parse(e.newValue) : initialValue);
          } catch {
            setStoredValue(initialValue);
          }
        }
      } else if (e instanceof CustomEvent) {
        if (e.detail.key === key) {
          try {
            setStoredValue(e.detail.value ? JSON.parse(e.detail.value) : initialValue);
          } catch {
            setStoredValue(initialValue);
          }
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleStorageChange);
    };
  }, [key, initialValue]);

  // Return a wrapped version of useState's setter function that ...
  // ... persists the new value to localStorage.
  // We use useCallback to ensure referential stability.
  const setValue = useCallback((value: T | ((val: T) => T)) => {
    try {
      const currentKey = keyRef.current;
      // Allow value to be a function so we have same API as useState
      const valueToStore = value instanceof Function ? value(stateRef.current) : value;

      // Update stateRef synchronously to support multiple sequential calls in the same render cycle
      stateRef.current = valueToStore;
      setStoredValue(valueToStore);

      // Save to local storage
      if (typeof window !== 'undefined') {
        const serializedValue = JSON.stringify(valueToStore);
        window.localStorage.setItem(currentKey, serializedValue);

        // Dispatch a custom event so other components in the same tab using this hook can sync
        // Use setTimeout to ensure we don't dispatch synchronously during a React render phase
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent(LOCAL_STORAGE_CHANGE_EVENT, {
              detail: { key: currentKey, value: serializedValue }
            })
          );
        }, 0);
      }
    } catch (error) {
      console.warn(`Error setting localStorage key "${keyRef.current}":`, error);
    }
  }, []);

  return [currentValue, setValue];
}
