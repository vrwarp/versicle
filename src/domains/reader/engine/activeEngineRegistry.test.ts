/**
 * The active-engine registry: one module-scope slot the reader lifecycle
 * fills on mount and clears on teardown, read lazily by the DEV/E2E test
 * API. Trivial, but a get that stopped reflecting the last set would make
 * every E2E reader predicate silently assert against a stale engine.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { ReaderEngine } from './ReaderEngine';
import { getActiveReaderEngine, setActiveReaderEngine } from './activeEngineRegistry';

const engineDouble = (id: string): ReaderEngine => ({ id }) as unknown as ReaderEngine;

afterEach(() => {
  setActiveReaderEngine(null);
});

describe('activeEngineRegistry', () => {
  it('reports the engine that was registered', () => {
    const engine = engineDouble('a');

    setActiveReaderEngine(engine);

    expect(getActiveReaderEngine()).toBe(engine);
  });

  it('replaces the previous engine on re-register', () => {
    const first = engineDouble('a');
    const second = engineDouble('b');

    setActiveReaderEngine(first);
    setActiveReaderEngine(second);

    expect(getActiveReaderEngine()).toBe(second);
  });

  it('clears back to null on teardown', () => {
    setActiveReaderEngine(engineDouble('a'));

    setActiveReaderEngine(null);

    expect(getActiveReaderEngine()).toBeNull();
  });

  it('is null when nothing has mounted', () => {
    expect(getActiveReaderEngine()).toBeNull();
  });
});
