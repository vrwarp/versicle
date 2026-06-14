/**
 * SearchSession lifecycle suite (Phase 7 PR-S1 exit): real engine through
 * the injected factory, repo-backed indexing, dispose-during-index,
 * engine-crash reset. No worker, no reader imports.
 */
import { describe, it, expect, vi } from 'vitest';
import { SearchEngine } from '@lib/search-engine';
import { SearchSession, type SearchEngineHandle, type SearchTextSource } from './SearchSession';
import { chunkSection } from './chunker';
import { MockEmbeddingClient } from '@domains/google';
import type { EmbeddedRowView, EmbeddingClientPort } from './embeddingPort';

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

// ── Increment D — hybrid semantic query path ─────────────────────────────────

const DIMS = 8;

/** A section whose text chunks deterministically (matches the indexer's defaults). */
const SEMANTIC_TEXT =
  'Call me Ishmael. Some years ago, never mind how long precisely, I thought I would sail about a little. ' +
  'The white whale swam beneath the moonlit waves toward the distant horizon.';
const SEMANTIC_HREF = 'ch1.xhtml';

/**
 * The B3 quantizer port (reuse the real SearchEngine helper, the same instance
 * shape the controller passes).
 */
const quantize = (vec: Float32Array) => new SearchEngine().quantizeInt8PerVector(vec);

/**
 * Seed an embedded row exactly the way the indexer does (Increment C): chunk the
 * section, embed each chunk under the 'document' profile, quantize + pack. Row r
 * ↔ chunk r, so semanticRank's re-chunk alignment holds.
 */
async function seededEmbeddedRow(
  client: EmbeddingClientPort,
  extractionVersion = 3,
): Promise<EmbeddedRowView> {
  const { chunks } = chunkSection({ href: SEMANTIC_HREF, title: 'Chapter 1', text: SEMANTIC_TEXT });
  const { vectors } = await client.embed(
    chunks.map((c) => c.text),
    { profile: 'document', bookId: 'bk-1', interactive: true },
  );
  const packed = new Int8Array(vectors.length * DIMS);
  const scales = new Float32Array(vectors.length);
  vectors.forEach((vec, i) => {
    const { vectors: q, scale } = quantize(vec);
    packed.set(q, i * DIMS);
    scales[i] = scale;
  });
  return {
    bookId: 'bk-1',
    model: 'mock-embed',
    dims: DIMS,
    quant: 'int8-pervec',
    extractionVersion,
    sections: [
      {
        href: SEMANTIC_HREF,
        sectionTextHash: 'h1',
        chunks: chunks.map((c) => ({ cfiStart: '', cfiEnd: '', tokenCount: c.tokenCount })),
        vectors: packed,
        scales,
      },
    ],
  };
}

const semanticTextSource = (extractionVersion = 3): SearchTextSource => ({
  get: vi.fn(async () => ({
    extractionVersion,
    sections: [{ href: SEMANTIC_HREF, title: 'Chapter 1', text: SEMANTIC_TEXT }],
  })),
});

const semanticConfig = (enabled = true) => () => ({ enabled, model: 'mock-embed', dims: DIMS });

describe('SearchSession — hybrid semantic query path (Increment D)', () => {
  it('caches the query embedding: two identical searches embed exactly once', async () => {
    const { factory } = makeFactory();
    // Spy on the mock client's embed, but seed the corpus through a separate
    // fixture instance so the seeding embeds (document profile) are not counted.
    const seedClient = new MockEmbeddingClient({ dims: DIMS });
    const embedded = await seededEmbeddedRow(seedClient);

    const queryClient = new MockEmbeddingClient({ dims: DIMS });
    const embedSpy = vi.spyOn(queryClient, 'embed');

    const session = new SearchSession({
      engineFactory: factory,
      textSource: semanticTextSource(),
      embeddingClient: queryClient,
      embeddingsSource: { get: vi.fn(async () => embedded) },
      quantize,
      getSemanticConfig: semanticConfig(true),
    });
    await session.index('bk-1', [{ id: 's1', href: SEMANTIC_HREF, title: 'Chapter 1', text: SEMANTIC_TEXT }]);

    const first = await session.search('bk-1', 'great white whale');
    const second = await session.search('bk-1', 'great white whale');

    // The repeated query reused the cached vector — exactly one query embed.
    expect(embedSpy).toHaveBeenCalledTimes(1);
    expect(embedSpy).toHaveBeenCalledWith(
      ['great white whale'],
      expect.objectContaining({ profile: 'query', bookId: 'bk-1', interactive: true }),
    );
    // Fusion preserves the regex result (none here) + semantic hits.
    expect(first.results.length).toBeGreaterThan(0);
    expect(second.results).toEqual(first.results);
  });

  it('regex is the DEFAULT when semantic is OFF (zero embed calls, result == regex)', async () => {
    const { factory } = makeFactory();
    const embedded = await seededEmbeddedRow(new MockEmbeddingClient({ dims: DIMS }));
    const queryClient = new MockEmbeddingClient({ dims: DIMS });
    const embedSpy = vi.spyOn(queryClient, 'embed');

    const session = new SearchSession({
      engineFactory: factory,
      textSource: semanticTextSource(),
      embeddingClient: queryClient,
      embeddingsSource: { get: vi.fn(async () => embedded) },
      quantize,
      getSemanticConfig: semanticConfig(false), // OFF
    });
    await session.index('bk-1', [{ id: 's1', href: SEMANTIC_HREF, title: 'Chapter 1', text: SEMANTIC_TEXT }]);

    const result = await session.search('bk-1', 'Ishmael');
    const regexOnly = await session.search('bk-1', 'Ishmael'); // recompute regex for parity

    expect(embedSpy).not.toHaveBeenCalled();
    // Identical to a pure regex searchDetailed (one occurrence of "Ishmael").
    expect(result.results.map((r) => r.charOffset)).toEqual(regexOnly.results.map((r) => r.charOffset));
    expect(result.results).toHaveLength(1);
  });

  it('regex is the DEFAULT when the client is unconfigured (no embed)', async () => {
    const { factory } = makeFactory();
    const embedded = await seededEmbeddedRow(new MockEmbeddingClient({ dims: DIMS }));
    const queryClient = new MockEmbeddingClient({ dims: DIMS, configured: false });
    const embedSpy = vi.spyOn(queryClient, 'embed');

    const session = new SearchSession({
      engineFactory: factory,
      textSource: semanticTextSource(),
      embeddingClient: queryClient,
      embeddingsSource: { get: vi.fn(async () => embedded) },
      quantize,
      getSemanticConfig: semanticConfig(true),
    });
    await session.index('bk-1', [{ id: 's1', href: SEMANTIC_HREF, title: 'Chapter 1', text: SEMANTIC_TEXT }]);

    const result = await session.search('bk-1', 'Ishmael');
    expect(embedSpy).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(1);
  });

  it('regex is the DEFAULT when the book is not embedded (empty row → no embed)', async () => {
    const { factory } = makeFactory();
    const queryClient = new MockEmbeddingClient({ dims: DIMS });
    const embedSpy = vi.spyOn(queryClient, 'embed');

    const session = new SearchSession({
      engineFactory: factory,
      textSource: semanticTextSource(),
      embeddingClient: queryClient,
      embeddingsSource: { get: vi.fn(async () => undefined) }, // never embedded
      quantize,
      getSemanticConfig: semanticConfig(true),
    });
    await session.index('bk-1', [{ id: 's1', href: SEMANTIC_HREF, title: 'Chapter 1', text: SEMANTIC_TEXT }]);

    const result = await session.search('bk-1', 'Ishmael');
    expect(embedSpy).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(1);
  });

  it('regex is the DEFAULT when the embed throws (quota exhausted / network)', async () => {
    const { factory } = makeFactory();
    const embedded = await seededEmbeddedRow(new MockEmbeddingClient({ dims: DIMS }));
    const throwingClient: EmbeddingClientPort = {
      isConfigured: () => true,
      embed: vi.fn(async () => {
        throw new Error('NET_RATE_LIMITED');
      }),
    };

    const session = new SearchSession({
      engineFactory: factory,
      textSource: semanticTextSource(),
      embeddingClient: throwingClient,
      embeddingsSource: { get: vi.fn(async () => embedded) },
      quantize,
      getSemanticConfig: semanticConfig(true),
    });
    await session.index('bk-1', [{ id: 's1', href: SEMANTIC_HREF, title: 'Chapter 1', text: SEMANTIC_TEXT }]);

    // The semantic branch threw — full-text result is returned UNCHANGED.
    const result = await session.search('bk-1', 'Ishmael');
    expect(throwingClient.embed).toHaveBeenCalledTimes(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].href).toBe(SEMANTIC_HREF);
  });

  it('exercises the real SearchEngine.rankInt8 through the in-process factory seam', async () => {
    const { factory, created } = makeFactory();
    const seedClient = new MockEmbeddingClient({ dims: DIMS });
    const embedded = await seededEmbeddedRow(seedClient);
    const queryClient = new MockEmbeddingClient({ dims: DIMS });

    // Spy on the REAL engine's rankInt8 to prove the worker-seam method ran.
    const rankSpy = vi.fn();

    const session = new SearchSession({
      engineFactory: () => {
        const handle = factory();
        const engine = handle.engine as SearchEngine;
        const original = engine.rankInt8.bind(engine);
        engine.rankInt8 = (...a: Parameters<SearchEngine['rankInt8']>) => {
          rankSpy(...a);
          return original(...a);
        };
        return handle;
      },
      textSource: semanticTextSource(),
      embeddingClient: queryClient,
      embeddingsSource: { get: vi.fn(async () => embedded) },
      quantize,
      getSemanticConfig: semanticConfig(true),
    });
    await session.index('bk-1', [{ id: 's1', href: SEMANTIC_HREF, title: 'Chapter 1', text: SEMANTIC_TEXT }]);

    const { results } = await session.search('bk-1', 'whale');
    // The real engine ranked the packed corpus (one call per embedded section).
    expect(rankSpy).toHaveBeenCalled();
    expect(created.length).toBeGreaterThan(0);
    // The regex hit for "whale" survives fusion alongside semantic chunk hits.
    expect(results.some((r) => SEMANTIC_TEXT.substring(r.charOffset, r.charOffset + r.matchLength).toLowerCase().includes('whale'))).toBe(true);
  });
});
