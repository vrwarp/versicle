/**
 * artifactPublisher suite (Artifact Lane Phase C gates): drives the PURE
 * runArtifactPublish core with injected fakes + a real MockBackend.
 *
 * Pins the privacy + idempotency guardrails (see GUARDRAILS):
 *  (1) shareAiCaches OFF → isUploadConsented false → zero putArtifact;
 *  (2) shareAiCaches ON + self active + backend connected → uploads each
 *      locally-embedded book under the ROW-derived contentKey;
 *  (3) disconnected (getBackend null) → zero putArtifact, no throw;
 *  (4) ifAbsent: a key already present is a no-op (the seeded bytes survive a
 *      second run — content-addressed, racing devices are byte-identical);
 *  (5) self idle (stale lastActive) → no-op (heartbeat-active gate);
 *  (6) client unconfigured → no-op;
 *  (7) a book with no embedding row / no contentHash is skipped (no upload).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runArtifactPublish, type ArtifactPublisherDeps } from './artifactPublisher';
import { MockBackend, clearMockArtifacts } from '@domains/sync/backend/MockBackend';
import { contentKey, type ArtifactStamp } from '@domains/search';
import type { CacheEmbeddingsRow } from '@data/rows/cache';
import type { DeviceInfo, DeviceProfile } from '~types/device';

const PROFILE: DeviceProfile = {
  theme: 'light',
  fontSize: 16,
  ttsVoiceURI: null,
  ttsRate: 1,
  ttsPitch: 1,
};

const NOW = 1_700_000_000_000;
const WORKSPACE = 'ws-1';
const UID = 'uid-1';
const CONTENT_HASH = 'book-content-hash';
const STAMP: ArtifactStamp = {
  model: 'gemini-embedding-001',
  dims: 4,
  quant: 'int8-pervec',
  extractionVersion: 3,
};

function selfDevice(lastActive: number): DeviceInfo {
  return {
    id: 'self',
    name: 'Self',
    platform: 'web',
    browser: 'Chrome',
    model: 'Desktop',
    userAgent: 'test',
    appVersion: '1.0.0',
    lastActive,
    created: NOW,
    profile: PROFILE,
  };
}

/** A persisted embedding row stamped to STAMP (binaries are raw ArrayBuffers). */
function row(bookId: string): CacheEmbeddingsRow {
  return {
    bookId,
    model: STAMP.model,
    dims: STAMP.dims,
    quant: STAMP.quant,
    extractionVersion: STAMP.extractionVersion,
    sections: [
      {
        href: 'ch1.xhtml',
        sectionTextHash: 'h1',
        chunks: [],
        vectors: Int8Array.from([1, 2, 3, 4]).buffer,
        scales: Float32Array.from([0.5]).buffer,
      },
    ],
  };
}

/** The contentKey the publisher derives for `bookId` from STAMP + CONTENT_HASH. */
function keyFor(): Promise<string> {
  return contentKey({ contentHash: CONTENT_HASH, ...STAMP });
}

/**
 * Build deps over a real MockBackend; `overrides` tunes each case. Defaults
 * model an active device, share-on consent, one locally-embedded book with a
 * resolvable contentHash, and a connected backend.
 */
function makeDeps(overrides: Partial<ArtifactPublisherDeps> = {}) {
  const backend = new MockBackend(UID);
  const rows: Record<string, CacheEmbeddingsRow | undefined> = { b1: row('b1') };
  const hashes: Record<string, string | undefined> = { b1: CONTENT_HASH };
  const deps: ArtifactPublisherDeps = {
    isUploadConsented: () => true,
    isClientConfigured: () => true,
    getDevices: () => ({ self: selfDevice(NOW) }),
    selfId: 'self',
    now: () => NOW,
    listBooks: () => ['b1'],
    getRow: async (bookId) => rows[bookId],
    getContentHash: async (bookId) => hashes[bookId],
    getBackend: () => ({ backend, workspaceId: WORKSPACE }),
    shouldContinue: () => true,
    ...overrides,
  };
  return { deps, backend };
}

describe('runArtifactPublish (Phase C)', () => {
  beforeEach(() => {
    clearMockArtifacts();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('uploads under the ROW-derived key when shareAiCaches ON + self active + connected', async () => {
    const { deps, backend } = makeDeps();
    await runArtifactPublish(deps);

    const key = await keyFor();
    // The HEAD doc + blob landed at the content-addressed paths.
    const head = await backend.headArtifact(WORKSPACE, `embedCache/${key}`);
    expect(head).not.toBeNull();
    const bytes = await backend.getArtifact(WORKSPACE, `embeddings/${key}.bin`);
    expect(bytes).not.toBeNull();
    // The HEAD stamp is `${model}|${dims}` (the publisher's meta).
    expect(head?.stamp).toBe(`${STAMP.model}|${STAMP.dims}`);
  });

  it('shareAiCaches OFF (isUploadConsented false): no upload', async () => {
    const put = vi.fn();
    const { deps, backend } = makeDeps({ isUploadConsented: () => false });
    vi.spyOn(backend, 'putArtifact').mockImplementation(put);
    await runArtifactPublish(deps);
    expect(put).not.toHaveBeenCalled();
  });

  it('client unconfigured: no-ops (never uploads)', async () => {
    const put = vi.fn();
    const { deps, backend } = makeDeps({ isClientConfigured: () => false });
    vi.spyOn(backend, 'putArtifact').mockImplementation(put);
    await runArtifactPublish(deps);
    expect(put).not.toHaveBeenCalled();
  });

  it('self idle (stale lastActive): no-ops (heartbeat-active gate)', async () => {
    const put = vi.fn();
    const { deps, backend } = makeDeps({
      getDevices: () => ({ self: selfDevice(NOW - 60 * 60 * 1000) }),
    });
    vi.spyOn(backend, 'putArtifact').mockImplementation(put);
    await runArtifactPublish(deps);
    expect(put).not.toHaveBeenCalled();
  });

  it('disconnected (getBackend null): zero uploads, no throw', async () => {
    const { deps } = makeDeps({ getBackend: () => null });
    await expect(runArtifactPublish(deps)).resolves.toBeUndefined();
  });

  it('no embedding row for a book: skipped (no upload)', async () => {
    const { deps, backend } = makeDeps({ getRow: async () => undefined });
    const put = vi.spyOn(backend, 'putArtifact');
    await runArtifactPublish(deps);
    expect(put).not.toHaveBeenCalled();
  });

  it('no contentHash (pre-P7 manifest): skipped (no upload)', async () => {
    const { deps, backend } = makeDeps({ getContentHash: async () => undefined });
    const put = vi.spyOn(backend, 'putArtifact');
    await runArtifactPublish(deps);
    expect(put).not.toHaveBeenCalled();
  });

  it('ifAbsent: an already-present key is a no-op (the seeded bytes survive a second write)', async () => {
    const { deps, backend } = makeDeps();
    const key = await keyFor();

    // Seed a DISTINCT blob under the key first (sentinel bytes); the publisher's
    // ifAbsent putArtifact must NOT overwrite it (content-addressed dedup).
    const sentinel = new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer;
    await backend.putArtifact(WORKSPACE, `embeddings/${key}.bin`, sentinel, {
      stamp: 'pre-seeded',
      size: sentinel.byteLength,
    });

    await runArtifactPublish(deps);

    // The seeded bytes are unchanged — the second (publisher) write was a no-op.
    const stored = await backend.getArtifact(WORKSPACE, `embeddings/${key}.bin`);
    expect(Array.from(new Uint8Array(stored!))).toEqual([0xde, 0xad, 0xbe, 0xef]);
    const head = await backend.headArtifact(WORKSPACE, `embedCache/${key}`);
    expect(head?.stamp).toBe('pre-seeded');
  });

  it('a per-book backend error is best-effort (logged + continue, no throw)', async () => {
    const { deps, backend } = makeDeps({ listBooks: () => ['b1'] });
    vi.spyOn(backend, 'putArtifact').mockRejectedValue(new Error('transient'));
    await expect(runArtifactPublish(deps)).resolves.toBeUndefined();
  });
});
