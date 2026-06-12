/**
 * SearchSession lifecycle suite (Phase 7 PR-S1 exit): real engine through
 * the injected factory, repo-backed indexing, dispose-during-index,
 * engine-crash reset. No worker, no reader imports.
 */
import { describe, it, expect, vi } from 'vitest';
import { SearchEngine } from '@lib/search-engine';
import { SearchSession, type SearchEngineHandle, type SearchTextSource } from './SearchSession';

function makeFactory() {
  const created: { engine: SearchEngine; dispose: ReturnType<typeof vi.fn> }[] = [];
  let errorListener: ((error: unknown) => void) | null = null;

  const factory = (): SearchEngineHandle => {
    const engine = new SearchEngine();
    const handle = {
      engine,
      dispose: vi.fn(),
      onError(listener: (error: unknown) => void) {
        errorListener = listener;
        return () => {
          errorListener = null;
        };
      },
    };
    created.push(handle);
    return handle;
  };

  return {
    factory,
    created,
    crash(error: unknown) {
      errorListener?.(error);
    },
  };
}

const corpus = (text = 'Call me Ishmael. Some years ago.') => ({
  extractionVersion: 3,
  sections: [{ href: 'ch1.xhtml', title: 'Chapter 1', text }],
});

describe('SearchSession', () => {
  it('indexes provided sections and searches with per-occurrence results', async () => {
    const { factory } = makeFactory();
    const session = new SearchSession({ engineFactory: factory });

    const outcome = await session.index('bk-1', [
      { id: 's1', href: 'ch1.xhtml', title: 'One', text: 'apple Apple' },
    ]);
    expect(outcome).toBe('indexed');
    expect(session.isIndexed('bk-1')).toBe(true);

    const { results, truncated } = await session.search('bk-1', 'apple');
    expect(truncated).toBe(false);
    expect(results.map((r) => r.occurrence)).toEqual([1, 2]);
    expect(results[0].sectionTitle).toBe('One');
  });

  it('falls back to the persisted corpus and reports no-text when neither exists', async () => {
    const { factory } = makeFactory();
    const textSource: SearchTextSource = {
      get: vi.fn(async (bookId: string) => (bookId === 'has-text' ? corpus() : undefined)),
    };
    const session = new SearchSession({ engineFactory: factory, textSource });

    await expect(session.index('has-text')).resolves.toBe('indexed');
    expect((await session.search('has-text', 'Ishmael')).results).toHaveLength(1);

    await expect(session.index('no-text')).resolves.toBe('no-text');
    expect(session.isIndexed('no-text')).toBe(false);
  });

  it('dedupes concurrent index calls for the same book (one extraction, one task)', async () => {
    const { factory } = makeFactory();
    let resolveGet: (row: ReturnType<typeof corpus>) => void;
    const textSource: SearchTextSource = {
      get: vi.fn(
        () =>
          new Promise<ReturnType<typeof corpus>>((resolve) => {
            resolveGet = resolve;
          }),
      ),
    };
    const session = new SearchSession({ engineFactory: factory, textSource });

    const a = session.index('bk-1');
    const b = session.index('bk-1');
    resolveGet!(corpus());

    await expect(Promise.all([a, b])).resolves.toEqual(['indexed', 'indexed']);
    expect(textSource.get).toHaveBeenCalledTimes(1);
  });

  it('dispose() rejects in-flight indexing (SEARCH_SESSION_DISPOSED) and clears caches', async () => {
    const { factory, created } = makeFactory();
    let resolveGet: (row: ReturnType<typeof corpus>) => void;
    const textSource: SearchTextSource = {
      get: () =>
        new Promise((resolve) => {
          resolveGet = resolve;
        }),
    };
    const session = new SearchSession({ engineFactory: factory, textSource });

    const pending = session.index('bk-1');
    session.dispose();
    resolveGet!(corpus());

    await expect(pending).rejects.toMatchObject({ code: 'SEARCH_SESSION_DISPOSED' });
    expect(session.isIndexed('bk-1')).toBe(false);
    // dispose() before the engine was ever constructed: nothing to release.
    expect(created).toHaveLength(0);
  });

  it('dispose() releases the engine handle and is idempotent', async () => {
    const { factory, created } = makeFactory();
    const session = new SearchSession({ engineFactory: factory });
    await session.index('bk-1', [{ id: 's1', href: 'c.xhtml', text: 'hello' }]);

    session.dispose();
    session.dispose();

    expect(created).toHaveLength(1);
    expect(created[0].dispose).toHaveBeenCalledTimes(1);
    expect(session.isIndexed('bk-1')).toBe(false);
  });

  it('an engine crash resets state, notifies onError, and the next search gets a fresh engine', async () => {
    const { factory, created, crash } = makeFactory();
    const onError = vi.fn();
    const session = new SearchSession({ engineFactory: factory, onError });

    await session.index('bk-1', [{ id: 's1', href: 'c.xhtml', text: 'hello world' }]);
    expect(session.isIndexed('bk-1')).toBe(true);

    const boom = new Error('worker died');
    crash(boom);

    // The dead-worker state is gone: no stale isIndexed:true (search.md #6).
    expect(onError).toHaveBeenCalledWith(boom);
    expect(session.isIndexed('bk-1')).toBe(false);
    expect(created[0].dispose).toHaveBeenCalledTimes(1);

    // Re-index transparently constructs a NEW engine.
    await session.index('bk-1', [{ id: 's1', href: 'c.xhtml', text: 'hello world' }]);
    expect(created).toHaveLength(2);
    expect((await session.search('bk-1', 'world')).results).toHaveLength(1);
  });
});
