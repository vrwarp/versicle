/**
 * semanticRank stamp-mismatch suite (Increment F §8.2): the READ path degrades
 * the whole book to regex-only ([]) when the embedded row's {model, dims, quant}
 * no longer matches the live config — vectors are NEVER converted (incompatible
 * spaces). The pre-existing extractionVersion guard is covered alongside, and a
 * MATCHING stamp proves the guard is the cause (the query embed still fires).
 */
import { describe, it, expect, vi } from 'vitest';
import { semanticRank, type SemanticRankArgs } from './semanticRank';
import { CURRENT_QUANT, type EmbeddedRowView } from './embeddingPort';
import type { SearchEngineProtocol, SearchTextSource } from './protocol';
import { QueryEmbeddingCache } from './queryEmbeddingCache';
import * as chunker from './chunker';

const DIMS = 4;

/**
 * A one-section embedded row view (typed-array views, as the repo hands over).
 * `chunkOffsets` optionally stamps the chunk with PERSISTED charStart/charEnd
 * (cleanup #10b — new rows); omitted → a LEGACY row that falls back to
 * re-segmentation on the read path.
 */
function embeddedRow(
  stamp: Pick<EmbeddedRowView, 'model' | 'dims' | 'quant'>,
  chunkOffsets?: { charStart: number; charEnd: number },
): EmbeddedRowView {
  return {
    bookId: 'bk-1',
    extractionVersion: 3,
    ...stamp,
    sections: [
      {
        href: 's0.xhtml',
        sectionTextHash: 'h0',
        chunks: [{ cfiStart: '', cfiEnd: '', tokenCount: 10, ...chunkOffsets }],
        vectors: Int8Array.from([12, -34, 56, -78]),
        scales: Float32Array.from([0.01]),
      },
    ],
  };
}

const corpus: NonNullable<Awaited<ReturnType<SearchTextSource['get']>>> = {
  extractionVersion: 3,
  sections: [{ href: 's0.xhtml', title: 's0', text: 'Call me Ishmael.' }],
};

function makeArgs(
  embedded: EmbeddedRowView | undefined,
  configStamp: { model: string; dims: number },
) {
  const embedSpy = vi.fn(async () => ({ vectors: [new Float32Array(DIMS).fill(0.5)] }));
  const rankSpy = vi.fn(() => [{ row: 0, cosine: 0.9 }]);
  const findBestSentencesSpy = vi.fn(async (_q, chunks) => chunks.map(() => ({ index: 0, cosine: 0.8 })));
  const engine = {
    rankInt8: rankSpy,
    findBestSentences: findBestSentencesSpy,
  } as unknown as SearchEngineProtocol;
  const args: SemanticRankArgs = {
    engine,
    embeddingClient: { embed: embedSpy, isConfigured: () => true },
    embeddingsSource: { get: vi.fn(async () => embedded) },
    textSource: { get: vi.fn(async () => corpus) } as unknown as SearchTextSource,
    quantize: (vec: Float32Array) => ({ vectors: new Int8Array(vec.length).fill(1), scale: 1 }),
    queryCache: new QueryEmbeddingCache(),
    config: configStamp,
    bookId: 'bk-1',
    query: 'whale',
    limit: 5,
  };
  return { args, embedSpy, rankSpy };
}

const LIVE = { model: 'gemini-embedding-001', dims: DIMS };

describe('semanticRank stamp-mismatch invalidation (read path → regex)', () => {
  it('returns [] (and never embeds/ranks) when the embedded model differs from the live config', async () => {
    const { args, embedSpy, rankSpy } = makeArgs(
      embeddedRow({ model: 'old-model', dims: DIMS, quant: CURRENT_QUANT }),
      LIVE,
    );
    await expect(semanticRank(args)).resolves.toEqual([]);
    // No vector conversion: the query is never embedded, the corpus never ranked.
    expect(embedSpy).not.toHaveBeenCalled();
    expect(rankSpy).not.toHaveBeenCalled();
  });

  it('returns [] when the embedded dims differ from the live config', async () => {
    const { args, embedSpy } = makeArgs(
      embeddedRow({ model: LIVE.model, dims: 768, quant: CURRENT_QUANT }),
      LIVE,
    );
    await expect(semanticRank(args)).resolves.toEqual([]);
    expect(embedSpy).not.toHaveBeenCalled();
  });

  it('returns [] when the extractionVersion drifted (pre-existing guard still holds)', async () => {
    const row = embeddedRow({ model: LIVE.model, dims: DIMS, quant: CURRENT_QUANT });
    row.extractionVersion = 2; // corpus is at 3
    const { args, embedSpy } = makeArgs(row, LIVE);
    await expect(semanticRank(args)).resolves.toEqual([]);
    expect(embedSpy).not.toHaveBeenCalled();
  });

  it('proceeds past the stamp guard (the query IS embedded) when {model,dims,quant} match', async () => {
    const { args, embedSpy } = makeArgs(
      embeddedRow({ model: LIVE.model, dims: DIMS, quant: CURRENT_QUANT }),
      LIVE,
    );
    const results = await semanticRank(args);
    // A matching stamp passes the guard, so the query embed fires (the proof
    // that the [] above was caused by the guard, not an unrelated early-out).
    expect(embedSpy).toHaveBeenCalledTimes(1);
    // The one section re-chunks to one chunk ↔ one packed row, yielding a hit.
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('semanticRank persisted char-offset read path (cleanup #10b)', () => {
  it('reads the PERSISTED charStart/charEnd WITHOUT re-segmenting (new rows)', async () => {
    // Persisted offsets that DIFFER from what re-segmentation would yield
    // (the whole-section [0, 16]) so the result proves the persisted values won.
    const chunkSpy = vi.spyOn(chunker, 'chunkSection');
    const { args } = makeArgs(
      embeddedRow({ model: LIVE.model, dims: DIMS, quant: CURRENT_QUANT }, { charStart: 5, charEnd: 12 }),
      LIVE,
    );

    const results = await semanticRank(args);

    expect(results).toHaveLength(1);
    // charOffset/matchLength come straight from the persisted offsets…
    expect(results[0].charOffset).toBe(5);
    expect(results[0].matchLength).toBe(12 - 5);
    // …and the deterministic chunker was NEVER re-run for this section.
    expect(chunkSpy).not.toHaveBeenCalled();
    chunkSpy.mockRestore();
  });

  it('falls back to re-segmentation for LEGACY rows lacking charStart/charEnd', async () => {
    const chunkSpy = vi.spyOn(chunker, 'chunkSection');
    const { args } = makeArgs(
      // No chunkOffsets → a legacy row.
      embeddedRow({ model: LIVE.model, dims: DIMS, quant: CURRENT_QUANT }),
      LIVE,
    );

    const results = await semanticRank(args);

    expect(results).toHaveLength(1);
    // Re-segmentation re-derives the whole-section chunk offsets [0, len].
    expect(results[0].charOffset).toBe(0);
    expect(results[0].matchLength).toBe(corpus.sections[0].text.length);
    // The fallback path DID re-run the chunker for the legacy section.
    expect(chunkSpy).toHaveBeenCalled();
    chunkSpy.mockRestore();
  });
});
