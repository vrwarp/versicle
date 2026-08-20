/**
 * Projection-store pins (Phase 7 §D). The WORKFLOW assertions of the
 * pre-cutover suite live on:
 *  - import/duplicate/replace/ghost/batch/restore →
 *    src/domains/library/importFlows.characterization.test.ts;
 *  - the five race invariants →
 *    src/domains/library/LibraryService.invariants.test.ts.
 * What remains here is the projection contract the UI renders.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useLibraryStore } from './useLibraryStore';
import { makeBookMetadata } from '@test/harness';

describe('useLibraryStore (UI projection)', () => {
  beforeEach(() => {
    useLibraryStore.setState({
      staticMetadata: {},
      offloadedBookIds: new Set<string>(),
      isHydrating: false,
      hasHydrated: false,
      isImporting: false,
      importProgress: 0,
      importStatus: '',
      uploadProgress: 0,
      uploadStatus: '',
      batchImportSummary: null,
      error: null,
    });
  });

  it('has the projection initial state', () => {
    const s = useLibraryStore.getState();
    expect(s.staticMetadata).toEqual({});
    expect(s.offloadedBookIds.size).toBe(0);
    expect(s.isImporting).toBe(false);
    expect(s.batchImportSummary).toBeNull();
    expect(s.error).toBeNull();
  });

  it('static metadata is per-key: set/remove never touch other keys', () => {
    const s = useLibraryStore.getState();
    s.setStaticMetadata('a', makeBookMetadata({ id: 'a' }));
    s.setStaticMetadata('b', makeBookMetadata({ id: 'b' }));
    s.removeStaticMetadata('a');

    const next = useLibraryStore.getState().staticMetadata;
    expect(next['a']).toBeUndefined();
    expect(next['b']).toBeDefined();
  });

  it('the offloaded set only supports per-key deltas (I-5 is structural)', () => {
    const s = useLibraryStore.getState();
    s.markOffloaded('x');
    s.markOffloaded('y');
    s.unmarkOffloaded('x');

    const set = useLibraryStore.getState().offloadedBookIds;
    expect(set.has('x')).toBe(false);
    expect(set.has('y')).toBe(true);
  });

  it('bulk writes land every entry in ONE reference change (boot hydration)', () => {
    const s = useLibraryStore.getState();
    const existing = makeBookMetadata({ id: 'a' });
    s.setStaticMetadata('a', existing);
    s.markOffloaded('x');

    let staticWrites = 0;
    let offloadedWrites = 0;
    let prevStatic = useLibraryStore.getState().staticMetadata;
    let prevOffloaded = useLibraryStore.getState().offloadedBookIds;
    const unsubscribe = useLibraryStore.subscribe((state) => {
      if (state.staticMetadata !== prevStatic) {
        staticWrites++;
        prevStatic = state.staticMetadata;
      }
      if (state.offloadedBookIds !== prevOffloaded) {
        offloadedWrites++;
        prevOffloaded = state.offloadedBookIds;
      }
    });

    const b = makeBookMetadata({ id: 'b' });
    const c = makeBookMetadata({ id: 'c' });
    useLibraryStore.getState().setStaticMetadataMany([['b', b], ['c', c]]);
    useLibraryStore.getState().markOffloadedMany(['y', 'z']);
    unsubscribe();

    // The whole batch is ONE identity change each — the per-key form made
    // libraryViewStore re-derive the entire shelf once per book.
    expect(staticWrites).toBe(1);
    expect(offloadedWrites).toBe(1);

    const after = useLibraryStore.getState();
    expect(Object.keys(after.staticMetadata).sort()).toEqual(['a', 'b', 'c']);
    expect(after.staticMetadata.a).toBe(existing); // untouched keys preserved
    expect([...after.offloadedBookIds].sort()).toEqual(['x', 'y', 'z']);
  });

  it('bulk writes with nothing new preserve references (render stability)', () => {
    const s = useLibraryStore.getState();
    const meta = makeBookMetadata({ id: 'a' });
    s.setStaticMetadata('a', meta);
    s.markOffloaded('x');

    const staticBefore = useLibraryStore.getState().staticMetadata;
    const offloadedBefore = useLibraryStore.getState().offloadedBookIds;

    useLibraryStore.getState().setStaticMetadataMany([['a', meta]]);
    useLibraryStore.getState().setStaticMetadataMany([]);
    useLibraryStore.getState().markOffloadedMany(['x']);
    useLibraryStore.getState().markOffloadedMany([]);

    expect(useLibraryStore.getState().staticMetadata).toBe(staticBefore);
    expect(useLibraryStore.getState().offloadedBookIds).toBe(offloadedBefore);
  });

  it('regression: no-op writes preserve references (render stability)', () => {
    const s = useLibraryStore.getState();
    const meta = makeBookMetadata({ id: 'a' });
    s.setStaticMetadata('a', meta);
    s.markOffloaded('x');

    const staticBefore = useLibraryStore.getState().staticMetadata;
    const offloadedBefore = useLibraryStore.getState().offloadedBookIds;

    // Same-value writes and misses must not produce new references.
    useLibraryStore.getState().setStaticMetadata('a', meta);
    useLibraryStore.getState().removeStaticMetadata('missing');
    useLibraryStore.getState().markOffloaded('x');
    useLibraryStore.getState().unmarkOffloaded('missing');

    expect(useLibraryStore.getState().staticMetadata).toBe(staticBefore);
    expect(useLibraryStore.getState().offloadedBookIds).toBe(offloadedBefore);
  });

  it('import progress projection transitions and clears', () => {
    const s = useLibraryStore.getState();
    s.setError('stale error');
    s.importStarted();

    let now = useLibraryStore.getState();
    expect(now.isImporting).toBe(true);
    expect(now.error).toBeNull();

    s.setImportProgress(40, 'Importing 1 of 2: a.epub');
    s.setUploadProgress(80, 'Processing books.zip...');
    now = useLibraryStore.getState();
    expect(now.importProgress).toBe(40);
    expect(now.uploadStatus).toBe('Processing books.zip...');

    s.importFinished();
    now = useLibraryStore.getState();
    expect(now.isImporting).toBe(false);
    expect(now.importProgress).toBe(0);
    expect(now.importStatus).toBe('');
  });

  it('regression: batch summary surfaces per-file outcomes and is dismissable (P0 D1 shape preserved)', () => {
    const summary = {
      imported: 2,
      skipped: ['dup.epub'],
      failed: [{ filename: 'bad.zip', reason: 'corrupted' }],
    };
    useLibraryStore.getState().setBatchImportSummary(summary);
    expect(useLibraryStore.getState().batchImportSummary).toEqual(summary);

    useLibraryStore.getState().clearBatchImportSummary();
    expect(useLibraryStore.getState().batchImportSummary).toBeNull();
  });
});
