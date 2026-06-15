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
  opts: { profile: EmbeddingProfile; bookId?: string; interactive?: boolean; lane?: 'fg' | 'bg' };
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

/**
 * The persisted-row stamp the indexer reads via repo.get for the §8.2 guard,
 * widened with the optional prior `sections` so resume can read-modify-write.
 * `vectors`/`scales` here are the typed-array VIEWS the production repo re-wraps
 * on read (the indexer's toArrayBuffer normalizes them back on write).
 */
type PriorSection = {
  href: string;
  sectionTextHash: string;
  chunks: CacheEmbeddingsRow['sections'][number]['chunks'];
  vectors: Int8Array;
  scales: Float32Array;
};
type PersistedStamp = Pick<CacheEmbeddingsRow, 'model' | 'dims' | 'quant'> & {
  sections?: PriorSection[];
};

function makeRepo(job?: CacheEmbedJobsRow, persisted?: PersistedStamp) {
  const puts: CacheEmbeddingsRow[] = [];
  const jobPuts: CacheEmbedJobsRow[] = [];
  const repo = {
    get: vi.fn(async () => persisted),
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
    // B-3: resume-skip requires the section's VECTORS to be present in the
    // persisted row (a job-complete-but-vectors-absent section re-embeds). So
    // the persisted row carries s0's vectors alongside the matching job entry.
    const persisted: PersistedStamp = {
      model: 'gemini-embedding-001',
      dims: 4,
      quant: 'int8-pervec',
      sections: [
        {
          href: 's0.xhtml',
          sectionTextHash: 'h0',
          chunks: [{ cfiStart: '', cfiEnd: '', tokenCount: 9 }],
          vectors: new Int8Array([1, 2, 3, 4]),
          scales: new Float32Array([0.125]),
        },
      ],
    };
    const { client, calls } = makeEmbeddingClient();
    const { repo } = makeRepo(priorJob, persisted);
    const indexer = new EmbeddingIndexer({
      embeddingClient: client,
      textSource: makeTextSource(sections),
      embeddingsRepo: repo,
      quantize,
      getConfig: config,
    });

    await indexer.enqueue('bk-1');
    // s0 is skipped (matched hash + vectors present); only s1 is embedded.
    expect(calls).toHaveLength(1);
  });

  it('B-3 self-heal: a job-complete section whose VECTORS are absent re-embeds (skip-but-empty)', async () => {
    // The §2.8 crash window: the job marks s0 complete but the persisted row has
    // NO s0 section (a crash between the two legacy writes, or a partial
    // hydrate). The guard must treat s0 as a MISS and re-embed, not continue
    // forever leaving it silently un-searchable.
    const sections = [section('s0.xhtml', 'h0')];
    const priorJob: CacheEmbedJobsRow = {
      bookId: 'bk-1',
      extractionVersion: 3,
      sections: [{ href: 's0.xhtml', embeddedThroughChunk: 1, sectionTextHash: 'h0' }],
      updatedAt: 0,
    };
    // Stamp matches the live config (so it is NOT a whole-row re-embed), but the
    // sections list is empty — s0's vectors never landed.
    const persisted: PersistedStamp = {
      model: 'gemini-embedding-001',
      dims: 4,
      quant: 'int8-pervec',
      sections: [],
    };
    const { client, calls } = makeEmbeddingClient();
    const { repo, puts } = makeRepo(priorJob, persisted);
    const indexer = new EmbeddingIndexer({
      embeddingClient: client,
      textSource: makeTextSource(sections),
      embeddingsRepo: repo,
      quantize,
      getConfig: config,
    });

    await indexer.enqueue('bk-1');
    // s0 re-embedded (the absent vectors are now materialized).
    expect(calls).toHaveLength(1);
    expect(puts[puts.length - 1].sections.map((s) => s.href)).toContain('s0.xhtml');
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

  it('a resumed run preserves prior persisted sections (read-modify-write, not overwrite)', async () => {
    const sections = [section('s0.xhtml', 'h0'), section('s1.xhtml', 'h1')];
    // The prior run already embedded s0: its job marks it done AND its vectors
    // live in the persisted row (returned by get() as typed-array views).
    const priorJob: CacheEmbedJobsRow = {
      bookId: 'bk-1',
      extractionVersion: 3,
      sections: [{ href: 's0.xhtml', embeddedThroughChunk: 1, sectionTextHash: 'h0' }],
      updatedAt: 0,
    };
    const s0Vectors = new Int8Array([1, 2, 3, 4]);
    const s0Scales = new Float32Array([0.125]);
    const persisted: PersistedStamp = {
      model: 'gemini-embedding-001',
      dims: 4,
      quant: 'int8-pervec',
      sections: [
        {
          href: 's0.xhtml',
          sectionTextHash: 'h0',
          chunks: [{ cfiStart: '', cfiEnd: '', tokenCount: 9 }],
          vectors: s0Vectors,
          scales: s0Scales,
        },
      ],
    };
    const { client, calls } = makeEmbeddingClient();
    const { repo, puts } = makeRepo(priorJob, persisted);
    const indexer = new EmbeddingIndexer({
      embeddingClient: client,
      textSource: makeTextSource(sections),
      embeddingsRepo: repo,
      quantize,
      getConfig: config, // stamp matches → s0 resume-skips, s1 re-embeds
    });

    await indexer.enqueue('bk-1');

    // Only s1 hit the embed client (s0 was resume-skipped).
    expect(calls).toHaveLength(1);
    expect(calls[0].texts.length).toBeGreaterThan(0);

    // The final persisted row carries BOTH the carried-forward s0 AND the
    // newly-embedded s1 — the resumed pass did NOT overwrite s0's vectors.
    const finalRow = puts[puts.length - 1];
    const finalHrefs = finalRow.sections.map((s) => s.href);
    expect(new Set(finalHrefs)).toEqual(new Set(['s0.xhtml', 's1.xhtml']));

    const s0 = finalRow.sections.find((s) => s.href === 's0.xhtml');
    expect(s0).toBeDefined();
    // s0's original vectors/scales survived, byte-for-byte.
    expect(Array.from(new Int8Array(s0!.vectors))).toEqual([1, 2, 3, 4]);
    expect(Array.from(new Float32Array(s0!.scales))).toEqual([0.125]);
    expect(s0!.sectionTextHash).toBe('h0');
  });

  describe('whole-row stamp-mismatch re-embed (Increment F §8.2)', () => {
    it('re-embeds EVERY section when the persisted row model differs, never resume-skipping stale-space vectors', async () => {
      const sections = [section('s0.xhtml', 'h0'), section('s1.xhtml', 'h1')];
      // A prior job would normally resume-skip s0 (matching hash)…
      const priorJob: CacheEmbedJobsRow = {
        bookId: 'bk-1',
        extractionVersion: 3,
        sections: [
          { href: 's0.xhtml', embeddedThroughChunk: 1, sectionTextHash: 'h0' },
          { href: 's1.xhtml', embeddedThroughChunk: 1, sectionTextHash: 'h1' },
        ],
        updatedAt: 0,
      };
      // …but the persisted row was embedded under a DIFFERENT model (an
      // incompatible space). The §8.2 guard must discard the job and re-embed.
      const persisted: PersistedStamp = { model: 'old-model', dims: 4, quant: 'int8-pervec' };
      const { client, calls } = makeEmbeddingClient();
      const { repo, puts } = makeRepo(priorJob, persisted);
      const indexer = new EmbeddingIndexer({
        embeddingClient: client,
        textSource: makeTextSource(sections),
        embeddingsRepo: repo,
        quantize,
        getConfig: config, // { model: 'gemini-embedding-001', dims: 4 }
      });

      await indexer.enqueue('bk-1');

      // BOTH sections re-embed (no resume-skip), and the re-written row carries
      // the LIVE config model — vectors were re-derived, never converted.
      expect(calls).toHaveLength(2);
      expect(puts[puts.length - 1].model).toBe('gemini-embedding-001');
    });

    it('re-embeds EVERY section when the persisted row dims differ', async () => {
      const sections = [section('s0.xhtml', 'h0')];
      const priorJob: CacheEmbedJobsRow = {
        bookId: 'bk-1',
        extractionVersion: 3,
        sections: [{ href: 's0.xhtml', embeddedThroughChunk: 1, sectionTextHash: 'h0' }],
        updatedAt: 0,
      };
      // dims 768 stored vs dims 4 live → incompatible space.
      const persisted: PersistedStamp = { model: 'gemini-embedding-001', dims: 768, quant: 'int8-pervec' };
      const { client, calls } = makeEmbeddingClient();
      const { repo } = makeRepo(priorJob, persisted);
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

    it('keeps the {href, sectionTextHash} resume-skip when the persisted stamp MATCHES the live config', async () => {
      const sections = [section('s0.xhtml', 'h0'), section('s1.xhtml', 'h1')];
      const priorJob: CacheEmbedJobsRow = {
        bookId: 'bk-1',
        extractionVersion: 3,
        sections: [{ href: 's0.xhtml', embeddedThroughChunk: 1, sectionTextHash: 'h0' }],
        updatedAt: 0,
      };
      // Stamp matches the live config → the per-section resume-skip still holds,
      // PROVIDED s0's vectors are actually present in the persisted row (B-3).
      const persisted: PersistedStamp = {
        model: 'gemini-embedding-001',
        dims: 4,
        quant: 'int8-pervec',
        sections: [
          {
            href: 's0.xhtml',
            sectionTextHash: 'h0',
            chunks: [{ cfiStart: '', cfiEnd: '', tokenCount: 9 }],
            vectors: new Int8Array([1, 2, 3, 4]),
            scales: new Float32Array([0.125]),
          },
        ],
      };
      const { client, calls } = makeEmbeddingClient();
      const { repo } = makeRepo(priorJob, persisted);
      const indexer = new EmbeddingIndexer({
        embeddingClient: client,
        textSource: makeTextSource(sections),
        embeddingsRepo: repo,
        quantize,
        getConfig: config,
      });

      await indexer.enqueue('bk-1');
      // s0 is resume-skipped (matched hash); only s1 re-embeds.
      expect(calls).toHaveLength(1);
    });
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
    // The default (FOREGROUND reader) posture: interactive:true, lane:'fg'.
    expect(calls[0].opts).toMatchObject({
      profile: 'document',
      bookId: 'bk-99',
      interactive: true,
      lane: 'fg',
    });
  });

  it('background enqueue { interactive:false, lane:"bg" } never sets interactive:true', async () => {
    const sections = [section('s0.xhtml', 'h0'), section('s1.xhtml', 'h1')];
    const { client, calls } = makeEmbeddingClient();
    const { repo } = makeRepo();
    const indexer = new EmbeddingIndexer({
      embeddingClient: client,
      textSource: makeTextSource(sections),
      embeddingsRepo: repo,
      quantize,
      getConfig: config,
    });

    await indexer.enqueue('bk-bg', undefined, { interactive: false, lane: 'bg' });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.opts).toMatchObject({ profile: 'document', bookId: 'bk-bg', interactive: false, lane: 'bg' });
      // The §8.4.1 invariant: a bg path is NEVER interactive:true.
      expect(call.opts.interactive).not.toBe(true);
    }
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

  describe('shared-AI-cache consult (Artifact Lane B-7, FG zero-quota path)', () => {
    it('full hit: enqueue() returns WITHOUT calling embed() (no acquire, no quota)', async () => {
      const sections = [section('s0.xhtml', 'h0'), section('s1.xhtml', 'h1')];
      const { client, calls } = makeEmbeddingClient();
      const { repo, puts, jobPuts } = makeRepo();
      const probe = vi.fn(async () => true);
      const hydrate = vi.fn(async () => true);
      const indexer = new EmbeddingIndexer({
        embeddingClient: client,
        textSource: makeTextSource(sections),
        embeddingsRepo: repo,
        quantize,
        getConfig: config,
        consult: { probe, hydrate },
      });

      await indexer.enqueue('bk-hit');

      // The consult fired and hydrated; embed() was NEVER called.
      expect(probe).toHaveBeenCalledWith('bk-hit');
      expect(hydrate).toHaveBeenCalledWith('bk-hit');
      expect(calls).toHaveLength(0);
      // The indexer itself wrote nothing (hydrate owns the local row write).
      expect(puts).toHaveLength(0);
      expect(jobPuts).toHaveLength(0);
    });

    it('probe miss: falls through to the normal embed loop', async () => {
      const sections = [section('s0.xhtml', 'h0')];
      const { client, calls } = makeEmbeddingClient();
      const { repo } = makeRepo();
      const probe = vi.fn(async () => false);
      const hydrate = vi.fn(async () => true);
      const indexer = new EmbeddingIndexer({
        embeddingClient: client,
        textSource: makeTextSource(sections),
        embeddingsRepo: repo,
        quantize,
        getConfig: config,
        consult: { probe, hydrate },
      });

      await indexer.enqueue('bk-miss');
      expect(probe).toHaveBeenCalledWith('bk-miss');
      expect(hydrate).not.toHaveBeenCalled();
      expect(calls).toHaveLength(1); // embedded normally
    });

    it('probe hit but hydrate fails: falls through to the embed loop', async () => {
      const sections = [section('s0.xhtml', 'h0')];
      const { client, calls } = makeEmbeddingClient();
      const { repo } = makeRepo();
      const indexer = new EmbeddingIndexer({
        embeddingClient: client,
        textSource: makeTextSource(sections),
        embeddingsRepo: repo,
        quantize,
        getConfig: config,
        consult: { probe: async () => true, hydrate: async () => false },
      });

      await indexer.enqueue('bk-partial');
      expect(calls).toHaveLength(1); // hydrate failed → embedded
    });
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
