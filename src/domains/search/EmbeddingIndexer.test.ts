/**
 * EmbeddingIndexer suite (Increment C §4): outward ordering from a current
 * CFI, resume-skip on {href, sectionTextHash}, consent + lane + bookId
 * threading through a fake EmbeddingClient port, the no-op when the client is
 * unconfigured, and the packed int8 + scales round-trip through a fake repo.
 */
import { describe, it, expect, vi } from 'vitest';
import { EmbeddingIndexer, orderOutward } from './EmbeddingIndexer';
import type { SearchTextSource } from './SearchSession';
import { MockEmbeddingClient, type EmbeddingProfile } from '@domains/google';
import type { CacheEmbeddingsRow, CacheEmbedJobsRow } from '@data/rows/cache';

interface CapturedEmbedCall {
  texts: string[];
  opts: { profile: EmbeddingProfile; bookId?: string; interactive?: boolean };
}

function makeEmbeddingClient(configured = true) {
  const calls: CapturedEmbedCall[] = [];
  const client = {
    isConfigured: () => configured,
    embed: vi.fn(async (texts: string[], opts: CapturedEmbedCall['opts']) => {
      calls.push({ texts, opts });
      // One deterministic 4-dim float vector per text.
      const vectors = texts.map(
        (_t, i) => new Float32Array([0.5 + i * 0.1, -0.25, 0.75, -0.5]),
      );
      return { vectors };
    }),
  };
  return { client, calls };
}

function makeRepo(job?: CacheEmbedJobsRow) {
  const puts: CacheEmbeddingsRow[] = [];
  const jobPuts: CacheEmbedJobsRow[] = [];
  const repo = {
    get: vi.fn(async () => undefined),
    getJob: vi.fn(async () => job),
    put: vi.fn(async (row: CacheEmbeddingsRow) => {
      puts.push(row);
    }),
    putJob: vi.fn(async (row: CacheEmbedJobsRow) => {
      jobPuts.push(row);
    }),
  };
  return { repo, puts, jobPuts };
}

/** A textSource over the given sections (each with a long enough text to chunk). */
function makeTextSource(
  sections: { href: string; title: string; text: string; sectionTextHash?: string }[],
  extractionVersion = 3,
): SearchTextSource {
  return { get: vi.fn(async () => ({ extractionVersion, sections })) };
}

function section(href: string, hash: string) {
  return {
    href,
    title: href,
    text: 'Call me Ishmael. Some years ago, never mind how long precisely.',
    sectionTextHash: hash,
  };
}

/** A simple per-vector int8 quantizer (the B3 port shape) for the suite. */
const quantize = (vec: Float32Array): { vectors: Int8Array; scale: number } => {
  let maxAbs = 0;
  for (const v of vec) maxAbs = Math.max(maxAbs, Math.abs(v));
  const out = new Int8Array(vec.length);
  if (maxAbs === 0) return { vectors: out, scale: 0 };
  const scale = maxAbs / 127;
  for (let i = 0; i < vec.length; i++) out[i] = Math.max(-128, Math.min(127, Math.round(vec[i] / scale)));
  return { vectors: out, scale };
};

const config = () => ({ model: 'gemini-embedding-001', dims: 4 });

describe('orderOutward', () => {
  it('fans out from the center covering every index once', () => {
    expect(orderOutward(5, 2)).toEqual([2, 3, 1, 4, 0]);
    expect(orderOutward(5, 0)).toEqual([0, 1, 2, 3, 4]);
    expect(orderOutward(4, 3)).toEqual([3, 2, 1, 0]);
    expect(orderOutward(0, 0)).toEqual([]);
  });
});

describe('EmbeddingIndexer', () => {
  it('orders sections outward from the current CFI (current section embedded first)', async () => {
    const sections = [
      section('s0.xhtml', 'h0'),
      section('s1.xhtml', 'h1'),
      section('s2.xhtml', 'h2'),
      section('s3.xhtml', 'h3'),
    ];
    const { client, calls } = makeEmbeddingClient();
    const { repo, puts } = makeRepo();
    const indexer = new EmbeddingIndexer({
      embeddingClient: client,
      textSource: makeTextSource(sections),
      embeddingsRepo: repo,
      quantize,
      getConfig: config,
    });

    // A position CFI whose spine step /6 maps to ordinal (6-2)/2 = 2.
    await indexer.enqueue('bk-1', 'epubcfi(/6/6!/4/2/1:0)');

    // The current section (ordinal 2 → s2) is persisted first, then the fan-out.
    const persistedOrder = puts.map((p) => p.sections[p.sections.length - 1].href);
    expect(persistedOrder[0]).toBe('s2.xhtml');
    // Every section ends up embedded.
    const finalHrefs = puts[puts.length - 1].sections.map((s) => s.href);
    expect(new Set(finalHrefs)).toEqual(new Set(['s0.xhtml', 's1.xhtml', 's2.xhtml', 's3.xhtml']));
    expect(calls.length).toBe(4);
  });

  it('falls back to section-0-first when the CFI is absent/unparseable', async () => {
    const sections = [section('s0.xhtml', 'h0'), section('s1.xhtml', 'h1')];
    const { client } = makeEmbeddingClient();
    const { repo, puts } = makeRepo();
    const indexer = new EmbeddingIndexer({
      embeddingClient: client,
      textSource: makeTextSource(sections),
      embeddingsRepo: repo,
      quantize,
      getConfig: config,
    });

    await indexer.enqueue('bk-1', 'not-a-cfi');
    expect(puts[0].sections[puts[0].sections.length - 1].href).toBe('s0.xhtml');
  });

  it('resume-skips a section whose {href, sectionTextHash} job entry already matches', async () => {
    const sections = [section('s0.xhtml', 'h0'), section('s1.xhtml', 'h1')];
    const priorJob: CacheEmbedJobsRow = {
      bookId: 'bk-1',
      extractionVersion: 3,
      sections: [{ href: 's0.xhtml', embeddedThroughChunk: 1, sectionTextHash: 'h0' }],
      updatedAt: 0,
    };
    const { client, calls } = makeEmbeddingClient();
    const { repo } = makeRepo(priorJob);
    const indexer = new EmbeddingIndexer({
      embeddingClient: client,
      textSource: makeTextSource(sections),
      embeddingsRepo: repo,
      quantize,
      getConfig: config,
    });

    await indexer.enqueue('bk-1');
    // s0 is skipped (matched hash); only s1 is embedded.
    expect(calls).toHaveLength(1);
  });

  it('re-embeds a section whose hash changed (re-extracted content)', async () => {
    const sections = [section('s0.xhtml', 'NEW-HASH')];
    const priorJob: CacheEmbedJobsRow = {
      bookId: 'bk-1',
      extractionVersion: 3,
      sections: [{ href: 's0.xhtml', embeddedThroughChunk: 1, sectionTextHash: 'OLD-HASH' }],
      updatedAt: 0,
    };
    const { client, calls } = makeEmbeddingClient();
    const { repo } = makeRepo(priorJob);
    const indexer = new EmbeddingIndexer({
      embeddingClient: client,
      textSource: makeTextSource(sections),
      embeddingsRepo: repo,
      quantize,
      getConfig: config,
    });

    await indexer.enqueue('bk-1');
    expect(calls).toHaveLength(1);
  });

  it('threads consent { bookId, interactive } + document profile into the embed port', async () => {
    const sections = [section('s0.xhtml', 'h0')];
    const { client, calls } = makeEmbeddingClient();
    const { repo } = makeRepo();
    const indexer = new EmbeddingIndexer({
      embeddingClient: client,
      textSource: makeTextSource(sections),
      embeddingsRepo: repo,
      quantize,
      getConfig: config,
    });

    await indexer.enqueue('bk-99');
    expect(calls[0].opts).toMatchObject({
      profile: 'document',
      bookId: 'bk-99',
      interactive: true,
    });
  });

  it('no-ops when the embedding client is unconfigured', async () => {
    const sections = [section('s0.xhtml', 'h0')];
    const { client, calls } = makeEmbeddingClient(false);
    const { repo, puts } = makeRepo();
    const textSource = makeTextSource(sections);
    const indexer = new EmbeddingIndexer({
      embeddingClient: client,
      textSource,
      embeddingsRepo: repo,
      quantize,
      getConfig: config,
    });

    await indexer.enqueue('bk-1');
    expect(calls).toHaveLength(0);
    expect(puts).toHaveLength(0);
    expect(textSource.get).not.toHaveBeenCalled();
  });

  it('packs int8 vectors + float32 scales that round-trip through the repo', async () => {
    const sections = [section('s0.xhtml', 'h0')];
    const { client } = makeEmbeddingClient();
    const { repo, puts } = makeRepo();
    const indexer = new EmbeddingIndexer({
      embeddingClient: client,
      textSource: makeTextSource(sections),
      embeddingsRepo: repo,
      quantize,
      getConfig: config,
    });

    await indexer.enqueue('bk-1');
    const persisted = puts[puts.length - 1];
    expect(persisted.quant).toBe('int8-pervec');
    expect(persisted.model).toBe('gemini-embedding-001');
    expect(persisted.dims).toBe(4);

    const sec = persisted.sections[0];
    // The vectors buffer re-wraps as Int8Array; scales as Float32Array.
    const vectors = new Int8Array(sec.vectors);
    const scales = new Float32Array(sec.scales);
    expect(vectors.length % 4).toBe(0);
    const rows = vectors.length / 4;
    expect(scales.length).toBe(rows);
    // Each chunk carries a tokenCount and empty CFIs (Phase D populates CFI).
    expect(sec.chunks.length).toBe(rows);
    expect(sec.chunks[0].cfiStart).toBe('');
    expect(sec.chunks[0].tokenCount).toBeGreaterThan(0);
    expect(sec.sectionTextHash).toBe('h0');
  });

  it('drives end-to-end through the MockEmbeddingClient deterministic fixture', async () => {
    const sections = [section('s0.xhtml', 'h0')];
    const { repo, puts } = makeRepo();
    const indexer = new EmbeddingIndexer({
      // The shared deterministic fixture client (hash-seeded unit vectors).
      embeddingClient: new MockEmbeddingClient({ dims: 4 }),
      textSource: makeTextSource(sections),
      embeddingsRepo: repo,
      quantize,
      getConfig: () => ({ model: 'gemini-embedding-001', dims: 4 }),
    });

    await indexer.enqueue('bk-1');
    expect(puts).toHaveLength(1);
    const sec = puts[0].sections[0];
    expect(new Int8Array(sec.vectors).length).toBe(4 * sec.chunks.length);
  });
});
