/**
 * embeddingCacheEvictionTask shaping (Artifact Lane Phase D): the
 * never-evict-unconfirmed-upload protected set. Drives the PURE
 * computeProtectedBookIds helper with injected fakes + a real MockBackend.
 *
 * Pins (see GUARDRAILS):
 *  - shareAiCaches OFF → empty set (evict exactly as today, zero HEAD probes);
 *  - no backend connected → empty set (nothing to confirm against);
 *  - shareAiCaches ON + connected → a book whose HEAD doc is MISSING
 *    (unconfirmed upload) is PROTECTED; a book whose HEAD doc is PRESENT
 *    (confirmed) is NOT;
 *  - a pre-P7 book (no contentHash) is not a protection candidate;
 *  - a probe throw FAIL-SAFE protects the book (offline blip ≠ confirmed).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computeProtectedBookIds, shouldTrickleNow } from './backgroundTasks';
import { MockBackend, clearMockArtifacts } from '@domains/sync/backend/MockBackend';
import { contentKey, CURRENT_QUANT } from '@domains/search';
import { TTS_EXTRACTION_VERSION } from '@lib/ingestion/sentence-extraction';
import type { SyncBackend } from '@domains/sync';

const WORKSPACE = 'ws-1';
const UID = 'uid-1';
const STAMP = { model: 'gemini-embedding-001', dims: 4 };

/** The contentKey the task derives for a given contentHash from STAMP. */
function keyFor(contentHash: string): Promise<string> {
  return contentKey({
    contentHash,
    model: STAMP.model,
    dims: STAMP.dims,
    quant: CURRENT_QUANT,
    extractionVersion: TTS_EXTRACTION_VERSION,
  });
}

/** Seed a confirmed-upload HEAD doc for `contentHash` into the backend. */
async function seedHead(backend: MockBackend, contentHash: string): Promise<void> {
  const key = await keyFor(contentHash);
  await backend.putArtifact(WORKSPACE, `embeddings/${key}.bin`, new Uint8Array([1]).buffer, {
    stamp: `${STAMP.model}|${STAMP.dims}`,
    size: 1,
  });
}

describe('computeProtectedBookIds (Phase D never-evict-unconfirmed-upload)', () => {
  beforeEach(() => {
    clearMockArtifacts();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('shareAiCaches OFF → empty set (evict as today, no probes)', async () => {
    const backend = new MockBackend(UID);
    const head = vi.spyOn(backend, 'headArtifact');
    const result = await computeProtectedBookIds({
      isShareEnabled: () => false,
      getBackend: () => ({ backend, workspaceId: WORKSPACE }),
      bookIds: ['b1'],
      getContentHash: async () => 'hash-1',
      getStamp: () => STAMP,
    });
    expect(result.size).toBe(0);
    // OFF short-circuits BEFORE any probe (zero added cost in the common case).
    expect(head).not.toHaveBeenCalled();
  });

  it('no backend connected → empty set', async () => {
    const result = await computeProtectedBookIds({
      isShareEnabled: () => true,
      getBackend: () => null,
      bookIds: ['b1'],
      getContentHash: async () => 'hash-1',
      getStamp: () => STAMP,
    });
    expect(result.size).toBe(0);
  });

  it('ON + connected: an unconfirmed-upload book (HEAD miss) is protected', async () => {
    const backend = new MockBackend(UID); // nothing seeded → HEAD miss
    const result = await computeProtectedBookIds({
      isShareEnabled: () => true,
      getBackend: () => ({ backend, workspaceId: WORKSPACE }),
      bookIds: ['b1'],
      getContentHash: async () => 'hash-1',
      getStamp: () => STAMP,
    });
    expect([...result]).toEqual(['b1']);
  });

  it('ON + connected: a confirmed-upload book (HEAD hit) is NOT protected', async () => {
    const backend = new MockBackend(UID);
    await seedHead(backend, 'hash-confirmed');
    const result = await computeProtectedBookIds({
      isShareEnabled: () => true,
      getBackend: () => ({ backend, workspaceId: WORKSPACE }),
      bookIds: ['b1'],
      getContentHash: async () => 'hash-confirmed',
      getStamp: () => STAMP,
    });
    expect(result.size).toBe(0);
  });

  it('ON + connected: mixed library — only the unconfirmed book is protected', async () => {
    const backend = new MockBackend(UID);
    await seedHead(backend, 'hash-confirmed');
    const result = await computeProtectedBookIds({
      isShareEnabled: () => true,
      getBackend: () => ({ backend, workspaceId: WORKSPACE }),
      bookIds: ['b-confirmed', 'b-unconfirmed'],
      getContentHash: async (bookId) =>
        bookId === 'b-confirmed' ? 'hash-confirmed' : 'hash-unconfirmed',
      getStamp: () => STAMP,
    });
    expect([...result]).toEqual(['b-unconfirmed']);
  });

  it('a pre-P7 book (no contentHash) is not a protection candidate', async () => {
    const backend = new MockBackend(UID);
    const head = vi.spyOn(backend, 'headArtifact');
    const result = await computeProtectedBookIds({
      isShareEnabled: () => true,
      getBackend: () => ({ backend, workspaceId: WORKSPACE }),
      bookIds: ['b1'],
      getContentHash: async () => undefined,
      getStamp: () => STAMP,
    });
    expect(result.size).toBe(0);
    // No content identity → no key → no probe.
    expect(head).not.toHaveBeenCalled();
  });

  it('a probe throw FAIL-SAFE protects the book (offline blip ≠ confirmed)', async () => {
    const stub = {
      uid: UID,
      headArtifact: async () => {
        throw new Error('offline');
      },
    } as unknown as SyncBackend;
    const result = await computeProtectedBookIds({
      isShareEnabled: () => true,
      getBackend: () => ({ backend: stub, workspaceId: WORKSPACE }),
      bookIds: ['b1'],
      getContentHash: async () => 'hash-1',
      getStamp: () => STAMP,
    });
    expect([...result]).toEqual(['b1']);
  });
});

describe('shouldTrickleNow (R7 gate)', () => {
  const ok = { onLine: true, visible: true, saveData: false, enabled: true, linked: true };

  it('allows only when opted-in, linked, online, foreground, and unmetered', () => {
    expect(shouldTrickleNow(ok)).toBe(true);
  });

  it('blocks when not opted in', () => {
    expect(shouldTrickleNow({ ...ok, enabled: false })).toBe(false);
  });

  it('blocks when no folder is linked', () => {
    expect(shouldTrickleNow({ ...ok, linked: false })).toBe(false);
  });

  it('blocks when offline', () => {
    expect(shouldTrickleNow({ ...ok, onLine: false })).toBe(false);
  });

  it('blocks when backgrounded', () => {
    expect(shouldTrickleNow({ ...ok, visible: false })).toBe(false);
  });

  it('blocks on a metered (save-data) connection', () => {
    expect(shouldTrickleNow({ ...ok, saveData: true })).toBe(false);
  });
});
