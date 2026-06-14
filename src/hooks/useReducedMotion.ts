import { useSyncExternalStore } from 'react';

/**
 * useReducedMotion (Phase 8 §K) — the JS half of the reduced-motion
 * policy. CSS animations/transitions are globally collapsed by the
 * `prefers-reduced-motion: reduce` block in index.css; JS-DRIVEN motion
 * (smooth scrolling, programmatic animation) cannot be reached by CSS and
 * consumes this hook instead (e.g. TTSQueue's follow-scroll).
 *
 * Live: re-renders when the user flips the OS/browser setting.
 */
const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(notify: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', notify);
  return () => mql.removeEventListener('change', notify);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
