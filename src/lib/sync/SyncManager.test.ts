import { describe, it, expect, vi } from 'vitest';
import type { SyncManifest, Annotation, LexiconRule } from '../../types/db';
import { SyncManager } from './SyncManager';

// Mock cfi-utils since it's used in SyncManager
// We want to test the orchestration of merges, not the CFI logic itself (which should be tested in cfi-utils.test.ts)
// However, for integration correctness, a simple functional mock is better than a no-op.
vi.mock('../cfi-utils', async (importOriginal) => {
    return {
        ...await importOriginal<unknown>(),
        mergeCfiRanges: (ranges: string[]) => {
            // Simple mock: dedupe and sort
            return Array.from(new Set(ranges)).sort();
        },
    };
});

describe('SyncManager', () => {
  const createBaseManifest = (deviceId: string, version = 1): SyncManifest => ({
    version,
    lastUpdated: 1000,
    deviceId,
    books: {},
    lexicon: [],
    readingList: {},
    transientState: { ttsPositions: {} },
    deviceRegistry: {}
  });

  describe('Book Metadata Merging (LWW)', () => {
    it('should prefer local metadata if lastRead is newer', () => {
      const local = createBaseManifest('local');
      local.books['book1'] = {
        metadata: { id: 'book1', lastRead: 2000, title: 'Local Title' },
        history: { bookId: 'book1', readRanges: [], sessions: [], lastUpdated: 2000 },
        annotations: []
      };

      const remote = createBaseManifest('remote');
      remote.books['book1'] = {
        metadata: { id: 'book1', lastRead: 1000, title: 'Remote Title' },
        history: { bookId: 'book1', readRanges: [], sessions: [], lastUpdated: 1000 },
        annotations: []
      };

      const merged = SyncManager.mergeManifests(local, remote);
      expect(merged.books['book1'].metadata.title).toBe('Local Title');
      expect(merged.books['book1'].metadata.lastRead).toBe(2000);
    });

    it('should prefer remote metadata if lastRead is newer', () => {
      const local = createBaseManifest('local');
      local.books['book1'] = {
        metadata: { id: 'book1', lastRead: 1000, title: 'Local Title' },
        history: { bookId: 'book1', readRanges: [], sessions: [], lastUpdated: 1000 },
        annotations: []
      };

      const remote = createBaseManifest('remote');
      remote.books['book1'] = {
        metadata: { id: 'book1', lastRead: 3000, title: 'Remote Title' },
        history: { bookId: 'book1', readRanges: [], sessions: [], lastUpdated: 3000 },
        annotations: []
      };

      const merged = SyncManager.mergeManifests(local, remote);
      expect(merged.books['book1'].metadata.title).toBe('Remote Title');
      expect(merged.books['book1'].metadata.lastRead).toBe(3000);
    });
  });

  describe('Reading History Merging (Union)', () => {
    it('should union read ranges', () => {
      const local = createBaseManifest('local');
      local.books['b1'] = {
        metadata: {},
        history: { bookId: 'b1', readRanges: ['cfi1'], sessions: [], lastUpdated: 100 },
        annotations: []
      };

      const remote = createBaseManifest('remote');
      remote.books['b1'] = {
        metadata: {},
        history: { bookId: 'b1', readRanges: ['cfi2'], sessions: [], lastUpdated: 200 },
        annotations: []
      };

      const merged = SyncManager.mergeManifests(local, remote);
      expect(merged.books['b1'].history.readRanges).toContain('cfi1');
      expect(merged.books['b1'].history.readRanges).toContain('cfi2');
    });
  });

  describe('Annotations Merging', () => {
    it('should merge unique annotations', () => {
      const a1: Annotation = { id: 'a1', bookId: 'b1', cfiRange: 'c1', text: 't1', type: 'highlight', color: 'red', created: 100 };
      const a2: Annotation = { id: 'a2', bookId: 'b1', cfiRange: 'c2', text: 't2', type: 'note', color: 'blue', created: 200 };

      const local = createBaseManifest('local');
      local.books['b1'] = { metadata: {}, history: { bookId:'b1', readRanges:[], sessions:[], lastUpdated:0 }, annotations: [a1] };

      const remote = createBaseManifest('remote');
      remote.books['b1'] = { metadata: {}, history: { bookId:'b1', readRanges:[], sessions:[], lastUpdated:0 }, annotations: [a2] };

      const merged = SyncManager.mergeManifests(local, remote);
      expect(merged.books['b1'].annotations).toHaveLength(2);
      expect(merged.books['b1'].annotations).toEqual(expect.arrayContaining([a1, a2]));
    });

    it('should handle duplicates by ID (simple override/preservation)', () => {
      const a1: Annotation = { id: 'a1', bookId: 'b1', cfiRange: 'c1', text: 't1', type: 'highlight', color: 'red', created: 100 };
      const a1_mod: Annotation = { id: 'a1', bookId: 'b1', cfiRange: 'c1', text: 't1_mod', type: 'highlight', color: 'red', created: 100 };

      const local = createBaseManifest('local');
      local.books['b1'] = { metadata: {}, history: { bookId:'b1', readRanges:[], sessions:[], lastUpdated:0 }, annotations: [a1] };

      const remote = createBaseManifest('remote');
      remote.books['b1'] = { metadata: {}, history: { bookId:'b1', readRanges:[], sessions:[], lastUpdated:0 }, annotations: [a1_mod] };

      const merged = SyncManager.mergeManifests(local, remote);
      // Implementation detail: Using Map sets usually keeps the last one inserted if we iterate local then remote?
      // Check implementation: map.set(id, a) for local, then for remote if not has.
      // Current implementation: "if (map.has(a.id)) { ... } else { map.set(a.id, a) }" iterating remote.
      // So local wins if conflict.

      expect(merged.books['b1'].annotations).toHaveLength(1);
      expect(merged.books['b1'].annotations[0].text).toBe('t1');
    });
  });

  describe('Lexicon Merging', () => {
    it('should merge lexicon rules', () => {
        const r1: LexiconRule = { id: 'r1', original: 'foo', replacement: 'bar', created: 100 };
        const r2: LexiconRule = { id: 'r2', original: 'baz', replacement: 'qux', created: 200 };

        const local = createBaseManifest('local');
        local.lexicon = [r1];
        const remote = createBaseManifest('remote');
        remote.lexicon = [r2];

        const merged = SyncManager.mergeManifests(local, remote);
        expect(merged.lexicon).toHaveLength(2);
    });
  });

  describe('Forward Compatibility', () => {
      it('should preserve unknown fields from remote manifest', () => {
          const local = createBaseManifest('local');
          const remote = createBaseManifest('remote');
          (remote as unknown as Record<string, unknown>).newFeatureField = 'someValue';

          const merged = SyncManager.mergeManifests(local, remote);
          expect((merged as unknown as Record<string, unknown>).newFeatureField).toBe('someValue');
      });
  });
});
