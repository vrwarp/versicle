/**
 * ArtifactConsult suite (Artifact Lane Phase B, shared-ai-cache-design.md
 * §2.4/§2.6/§2.7): drives makeArtifactConsult against a real MockBackend seeded
 * (putArtifact) with a header-format blob, plus stub backends for the §2.7 error
 * taxonomy.
 *
 * Pins:
 *  - probe HIT/MISS (HEAD doc present/absent for the derived contentKey);
 *  - hydrate materializes the local row via putHydrated (atomic §2.8);
 *  - stale-section reconciliation drops diverged sections (partial hydrate),
 *    marking ONLY the survivors complete in the job row;
 *  - stamp mismatch (re-derived key !== requested) → null (the §2.4 bit-rot
 *    rejection);
 *  - getArtifact transient/permission errors RETHROW (NOT a miss — §2.7);
 *  - consent OFF + no per-book bit → DENIED (§2.6 hard requirement);
 *  - contentHash-absent manifest → graceful false/null (pre-P7 degrade).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockBackend, clearMockArtifacts } from '@domains/sync/backend/MockBackend';
import { contentKey, type ArtifactStamp, type ArtifactBlobHeader } from '@domains/search';
import { ARTIFACT_HEADER_VERSION } from '@domains/search/artifactBlob';
import { makeArtifactConsult, type ArtifactConsultDeps } from './artifactConsult';
import type { StaticManifestRow } from '@data/rows/static';
import type {
  CacheEmbeddingsRow,
  CacheEmbedJobsRow,
  CacheSearchTextRow,
} from '@data/rows/cache';
import type { SyncBackend } from '@domains/sync';

const WORKSPACE = 'ws-1';
const UID = 'uid-1';
const STAMP: ArtifactStamp = {
  model: 'gemini-embedding-001',
  dims: 4,
  quant: 'int8-pervec',
  extractionVersion: 3,
};

/** Hand-build a header-format blob (serialize side is Phase C). */
function buildBlob(
  headerStamp: ArtifactStamp,
  sections: { href: string; sectionTextHash: string; vectors: Int8Array; scales: Float32Array }[],
): ArrayBuffer {
  const bodyChunks: Uint8Array[] = [];
  const headerSections: ArtifactBlobHeader['sections'] = [];
  let offset = 0;
  for (const s of sections) {
    const vb = new Uint8Array(s.vectors.buffer, s.vectors.byteOffset, s.vectors.byteLength);
    const sb = new Uint8Array(s.scales.buffer, s.scales.byteOffset, s.scales.byteLength);
    const sliceLen = vb.byteLength + sb.byteLength;
    const slice = new Uint8Array(sliceLen);
    slice.set(vb, 0);
    slice.set(sb, vb.byteLength);
    headerSections.push({
      href: s.href,
      sectionTextHash: s.sectionTextHash,
      byteOffset: offset,
      byteLen: sliceLen,
      vectorsByteLen: vb.byteLength,
    });
    bodyChunks.push(slice);
    offset += sliceLen;
    const pad = (4 - (offset % 4)) % 4;
    if (pad > 0) {
      bodyChunks.push(new Uint8Array(pad));
      offset += pad;
    }
  }
  const body = new Uint8Array(offset);
  let cursor = 0;
  for (const c of bodyChunks) {
    body.set(c, cursor);
    cursor += c.byteLength;
  }
  const header: ArtifactBlobHeader = {
    headerVersion: ARTIFACT_HEADER_VERSION,
    model: headerStamp.model,
    dims: headerStamp.dims,
    quant: headerStamp.quant,
    extractionVersion: headerStamp.extractionVersion,
    sections: headerSections,
  };
  const headerJson = new TextEncoder().encode(JSON.stringify(header));
  const bytes = new Uint8Array(4 + headerJson.byteLength + body.byteLength);
  new DataView(bytes.buffer).setUint32(0, headerJson.byteLength, true);
  bytes.set(headerJson, 4);
  bytes.set(body, 4 + headerJson.byteLength);
  return bytes.buffer;
}

const SECTIONS = [
  { href: 'ch1.xhtml', sectionTextHash: 'h1', vectors: Int8Array.from([1, 2, 3, 4]), scales: Float32Array.from([0.5]) },
  { href: 'ch2.xhtml', sectionTextHash: 'h2', vectors: Int8Array.from([5, 6, 7, 8]), scales: Float32Array.from([0.25]) },
];

/** A live corpus matching the seeded blob's section hashes. */
function corpus(
  sections: { href: string; sectionTextHash?: string }[] = [
    { href: 'ch1.xhtml', sectionTextHash: 'h1' },
    { href: 'ch2.xhtml', sectionTextHash: 'h2' },
  ],
): CacheSearchTextRow {
  return {
    bookId: 'bk-1',
    extractionVersion: 3,
    sections: sections.map((s) => ({ href: s.href, title: s.href, text: 'x', sectionTextHash: s.sectionTextHash })),
  };
}

function manifest(contentHash?: string): StaticManifestRow {
  return {
    bookId: 'bk-1',
    title: 'T',
    author: 'A',
    fileHash: 'fh',
    contentHash,
    fileSize: 1,
    totalChars: 1,
    schemaVersion: 1,
  };
}

/**
 * Seed a MockBackend with the blob at `embeddings/{key}.bin` (which makes the
 * HEAD doc resolvable at `embedCache/{key}`). Returns the backend + the key.
 */
async function seedBackend(
  headerStamp: ArtifactStamp = STAMP,
  contentHash = 'book-hash',
): Promise<{ backend: MockBackend; key: string }> {
  const backend = new MockBackend(UID);
  const key = await contentKey({ contentHash, ...STAMP });
  const blob = buildBlob(headerStamp, SECTIONS);
  await backend.putArtifact(WORKSPACE, `embeddings/${key}.bin`, blob, {
    stamp: `${headerStamp.model}|${headerStamp.dims}`,
    size: blob.byteLength,
  });
  return { backend, key };
}

/** Default deps over a seeded backend; overrides tune each case. */
function makeDeps(
  backend: SyncBackend | null,
  overrides: Partial<ArtifactConsultDeps> = {},
): { deps: ArtifactConsultDeps; hydrated: { row: CacheEmbeddingsRow; jobRow: CacheEmbedJobsRow }[] } {
  const hydrated: { row: CacheEmbeddingsRow; jobRow: CacheEmbedJobsRow }[] = [];
  const deps: ArtifactConsultDeps = {
    getBackend: () => (backend ? { backend, workspaceId: WORKSPACE } : null),
    getManifest: async () => manifest('book-hash'),
    getStamp: () => STAMP,
    getLiveCorpus: async () => corpus(),
    putHydrated: async (row, jobRow) => {
      hydrated.push({ row, jobRow });
    },
    isConsented: () => true,
    ...overrides,
  };
  return { deps, hydrated };
}

describe('makeArtifactConsult', () => {
  beforeEach(() => {
    clearMockArtifacts();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  describe('probeArtifact', () => {
    it('HIT: returns true when the HEAD doc exists for the derived key', async () => {
      const { backend } = await seedBackend();
      const { deps } = makeDeps(backend);
      const consult = makeArtifactConsult(deps);
      await expect(consult.probeArtifact('bk-1', { interactive: false })).resolves.toBe(true);
    });

    it('MISS: returns false when no HEAD doc exists', async () => {
      const backend = new MockBackend(UID); // nothing seeded
      const { deps } = makeDeps(backend);
      const consult = makeArtifactConsult(deps);
      await expect(consult.probeArtifact('bk-1', { interactive: false })).resolves.toBe(false);
    });

    it('no backend connected → false (cheap no-network short-circuit)', async () => {
      const { deps } = makeDeps(null);
      const consult = makeArtifactConsult(deps);
      await expect(consult.probeArtifact('bk-1', { interactive: true })).resolves.toBe(false);
    });

    it('contentHash-absent manifest (pre-P7) → graceful false', async () => {
      const { backend } = await seedBackend();
      const { deps } = makeDeps(backend, { getManifest: async () => manifest(undefined) });
      const consult = makeArtifactConsult(deps);
      await expect(consult.probeArtifact('bk-1', { interactive: false })).resolves.toBe(false);
    });
  });

  describe('hydrateFromArtifact', () => {
    it('materializes the local row via putHydrated (atomic §2.8) and returns it', async () => {
      const { backend } = await seedBackend();
      const { deps, hydrated } = makeDeps(backend);
      const consult = makeArtifactConsult(deps);

      const row = await consult.hydrateFromArtifact('bk-1', { interactive: false });
      expect(row).not.toBeNull();
      expect(hydrated).toHaveLength(1);

      // Both sections reconciled (live corpus hashes match the blob header).
      expect(hydrated[0].row.sections.map((s) => s.href)).toEqual(['ch1.xhtml', 'ch2.xhtml']);
      expect(Array.from(new Int8Array(hydrated[0].row.sections[0].vectors))).toEqual([1, 2, 3, 4]);
      expect(Array.from(new Float32Array(hydrated[0].row.sections[1].scales))).toEqual([0.25]);
      // The completed job marks BOTH sections (full hydrate).
      expect(hydrated[0].jobRow.sections.map((s) => s.href)).toEqual(['ch1.xhtml', 'ch2.xhtml']);
      // The row stamp comes from the blob header.
      expect(hydrated[0].row).toMatchObject({ model: STAMP.model, dims: STAMP.dims, quant: 'int8-pervec' });
    });

    it('stale-section reconciliation: a diverged live hash DROPS that section (partial hydrate)', async () => {
      const { backend } = await seedBackend();
      // The live corpus has ch1 matching but ch2 RE-EXTRACTED (hash diverged).
      const { deps, hydrated } = makeDeps(backend, {
        getLiveCorpus: async () =>
          corpus([
            { href: 'ch1.xhtml', sectionTextHash: 'h1' },
            { href: 'ch2.xhtml', sectionTextHash: 'DIVERGED' },
          ]),
      });
      const consult = makeArtifactConsult(deps);

      const row = await consult.hydrateFromArtifact('bk-1', { interactive: false });
      expect(row).not.toBeNull();
      // Only ch1 survived; ch2 dropped (re-embeds next pass).
      expect(hydrated[0].row.sections.map((s) => s.href)).toEqual(['ch1.xhtml']);
      // The job marks ONLY ch1 complete → ch2 is NOT resume-skipped.
      expect(hydrated[0].jobRow.sections.map((s) => s.href)).toEqual(['ch1.xhtml']);
    });

    it('no reconcilable section (every live hash diverged) → null, nothing hydrated', async () => {
      const { backend } = await seedBackend();
      const { deps, hydrated } = makeDeps(backend, {
        getLiveCorpus: async () =>
          corpus([
            { href: 'ch1.xhtml', sectionTextHash: 'X' },
            { href: 'ch2.xhtml', sectionTextHash: 'Y' },
          ]),
      });
      const consult = makeArtifactConsult(deps);
      await expect(consult.hydrateFromArtifact('bk-1', { interactive: false })).resolves.toBeNull();
      expect(hydrated).toHaveLength(0);
    });

    it('stamp mismatch: a blob whose header stamp re-derives a different key → null (bit-rot reject)', async () => {
      // Seed a blob whose HEADER describes a DIFFERENT model than the requested
      // stamp, but stored under the requested key (a swap/bit-rot). The consult
      // re-derives the key from the header stamp and rejects on mismatch.
      const backend = new MockBackend(UID);
      const key = await contentKey({ contentHash: 'book-hash', ...STAMP });
      const tamperedBlob = buildBlob({ ...STAMP, model: 'attacker-model' }, SECTIONS);
      await backend.putArtifact(WORKSPACE, `embeddings/${key}.bin`, tamperedBlob, {
        stamp: 'tampered',
        size: tamperedBlob.byteLength,
      });
      const { deps, hydrated } = makeDeps(backend);
      const consult = makeArtifactConsult(deps);

      await expect(consult.hydrateFromArtifact('bk-1', { interactive: false })).resolves.toBeNull();
      expect(hydrated).toHaveLength(0);
    });

    it('definitive miss (getArtifact → null) → null', async () => {
      const backend = new MockBackend(UID); // nothing seeded → getArtifact null
      const { deps, hydrated } = makeDeps(backend);
      const consult = makeArtifactConsult(deps);
      await expect(consult.hydrateFromArtifact('bk-1', { interactive: false })).resolves.toBeNull();
      expect(hydrated).toHaveLength(0);
    });

    it('transient/permission error from getArtifact RETHROWS (NOT a miss — §2.7)', async () => {
      // A backend whose getArtifact throws a transient error: the consult must
      // propagate it (never mistake an offline blip for a miss and burn quota).
      // Only the artifact trio is exercised by hydrate; the rest is unused.
      const transient = new Error('storage/retry-limit-exceeded');
      const stub = {
        uid: UID,
        headArtifact: async () => ({ exists: true as const, stamp: 's', size: 1 }),
        getArtifact: async () => {
          throw transient;
        },
      } as unknown as SyncBackend;
      const { deps } = makeDeps(stub);
      const consult = makeArtifactConsult(deps);
      await expect(consult.hydrateFromArtifact('bk-1', { interactive: false })).rejects.toBe(transient);
    });

    it('an unparseable (corrupt) blob is a definitive non-hit → null', async () => {
      const backend = new MockBackend(UID);
      const key = await contentKey({ contentHash: 'book-hash', ...STAMP });
      // Garbage bytes: claims a huge header length.
      const junk = new Uint8Array(8);
      new DataView(junk.buffer).setUint32(0, 9999, true);
      await backend.putArtifact(WORKSPACE, `embeddings/${key}.bin`, junk.buffer, {
        stamp: 'junk',
        size: junk.byteLength,
      });
      const { deps, hydrated } = makeDeps(backend);
      const consult = makeArtifactConsult(deps);
      await expect(consult.hydrateFromArtifact('bk-1', { interactive: false })).resolves.toBeNull();
      expect(hydrated).toHaveLength(0);
    });
  });

  describe('read-path consent gate (§2.6 hard requirement)', () => {
    it('consent OFF + no per-book bit: probe AND hydrate are DENIED (no network, nothing written)', async () => {
      const { backend } = await seedBackend();
      const getArtifact = vi.spyOn(backend, 'getArtifact');
      const headArtifact = vi.spyOn(backend, 'headArtifact');
      const { deps, hydrated } = makeDeps(backend, {
        // Mirrors makeAiConsentResolver: not interactive, no preEmbed, no bit.
        isConsented: () => false,
      });
      const consult = makeArtifactConsult(deps);

      await expect(consult.probeArtifact('bk-1', { interactive: false })).resolves.toBe(false);
      await expect(consult.hydrateFromArtifact('bk-1', { interactive: false })).resolves.toBeNull();
      // The denial short-circuits BEFORE any backend call (no bytes leave).
      expect(headArtifact).not.toHaveBeenCalled();
      expect(getArtifact).not.toHaveBeenCalled();
      expect(hydrated).toHaveLength(0);
    });

    it('consent granted (interactive gesture): proceeds even with opt-in OFF', async () => {
      const { backend } = await seedBackend();
      // The gate grants on interactive:true (the FG reader-open gesture).
      const { deps } = makeDeps(backend, {
        isConsented: (_bookId, { interactive }) => interactive,
      });
      const consult = makeArtifactConsult(deps);
      await expect(consult.probeArtifact('bk-1', { interactive: true })).resolves.toBe(true);
      await expect(consult.hydrateFromArtifact('bk-1', { interactive: true })).resolves.not.toBeNull();
    });
  });
});
