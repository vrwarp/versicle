/**
 * Active-engine registry — the prod-safe seam behind
 * `window.__versicleTest.reader` (Phase 6 §2b test seam).
 *
 * The reader lifecycle registers its live ReaderEngine here on mount and
 * clears it on teardown. The DEV/VITE_E2E-only test API (src/test-api.ts)
 * reads it lazily to expose the typed E2E predicates that replaced the raw
 * `window.rendition` / `__reader_added_annotations_count` globals. This
 * module itself is inert in production: one module-scope variable, no side
 * effects, no test-api import (so the test API never enters the prod graph).
 */
import type { ReaderEngine } from './ReaderEngine';

let activeEngine: ReaderEngine | null = null;

export function setActiveReaderEngine(engine: ReaderEngine | null): void {
  activeEngine = engine;
}

export function getActiveReaderEngine(): ReaderEngine | null {
  return activeEngine;
}
