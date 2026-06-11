/**
 * Row-schema round-trip tests (Phase 3 D4, exit criteria of PR P3-5).
 *
 * The schemas are loose envelopes with strict required keys: a row written
 * by ANY past build must parse, parse output must be deep-equal to the
 * input (passthrough — validation never mutates persisted data), and rows
 * missing identity/required fields must fail. This is the bit-compatibility
 * proof for the format-free rows/ PR: nothing is rewritten, reshaped, or
 * stripped.
 */
import { describe, it, expect } from 'vitest';
import {
  backupStaticManifestRowSchema,
  bookLocationsRowSchema,
  cacheAudioBlobRowSchema,
  cacheRenderMetricsRowSchema,
  cacheSessionStateRowSchema,
  cacheTtsPreparationRowSchema,
  flightSnapshotRowSchema,
  staticManifestRowSchema,
  staticResourceRowSchema,
  staticStructureRowSchema,
  syncCheckpointRowSchema,
  syncLogEntryRowSchema,
  tableImageRowSchema,
} from './index';

const expectRoundTrip = <T>(schema: { parse(v: unknown): unknown }, row: T): void => {
  expect(schema.parse(row)).toEqual(row);
};

describe('data/rows schemas', () => {
  describe('static domain', () => {
    const manifest = {
      bookId: 'b-1',
      title: 'A Book',
      author: 'An Author',
      description: 'desc',
      fileHash: 'hash',
      fileSize: 123,
      totalChars: 456,
      schemaVersion: 3,
      coverBlob: new ArrayBuffer(4),
      coverPalette: [1, 2, 3],
      perceptualPalette: { standout: 1, background: 2, deltaE: 3.5 },
      language: 'en',
      baseFontSize: 16,
      baseLineHeight: 24,
    };

    it('round-trips a full static_manifests row (ArrayBuffer cover)', () => {
      expectRoundTrip(staticManifestRowSchema, manifest);
    });

    it('round-trips a legacy Blob cover and unknown future fields (loose envelope)', () => {
      const legacy = {
        ...manifest,
        coverBlob: new Blob([new Uint8Array([1, 2])]),
        someFutureField: { nested: true },
      };
      expectRoundTrip(staticManifestRowSchema, legacy);
    });

    it('rejects a manifest row corrupted by pre-v3 JSON restores (coverBlob: {})', () => {
      expect(staticManifestRowSchema.safeParse({ ...manifest, coverBlob: {} }).success).toBe(false);
    });

    it('rejects a manifest row without its identity', () => {
      const rest: Record<string, unknown> = { ...manifest };
      delete rest.bookId;
      expect(staticManifestRowSchema.safeParse(rest).success).toBe(false);
      expect(staticManifestRowSchema.safeParse({ ...manifest, bookId: '' }).success).toBe(false);
    });

    it('round-trips static_resources rows in both persisted binary states', () => {
      expectRoundTrip(staticResourceRowSchema, { bookId: 'b-1', epubBlob: new ArrayBuffer(8) });
      expectRoundTrip(staticResourceRowSchema, { bookId: 'b-1', epubBlob: new Blob([new Uint8Array([80, 75])]) });
      expect(staticResourceRowSchema.safeParse({ bookId: 'b-1', epubBlob: 'nope' }).success).toBe(false);
    });

    it('round-trips static_structure rows including nested TOC subitems', () => {
      expectRoundTrip(staticStructureRowSchema, {
        bookId: 'b-1',
        toc: [
          {
            id: 't1',
            href: 'ch1.html',
            label: 'One',
            subitems: [{ id: 't1.1', href: 'ch1.html#s', label: 'Sub', parent: 't1' }],
          },
        ],
        spineItems: [{ id: 'ch1.html', characterCount: 10, index: 0 }],
      });
    });
  });

  describe('cache domain', () => {
    it('round-trips a canonical cache_audio_blobs row (alignment + size)', () => {
      expectRoundTrip(cacheAudioBlobRowSchema, {
        key: 'sha-1',
        audio: new ArrayBuffer(16),
        alignment: [{ timeSeconds: 0.5, charIndex: 3, type: 'word' }],
        createdAt: 1,
        lastAccessed: 2,
        size: 16,
      });
    });

    it('round-trips a LEGACY audio row written under alignmentData (read-shim input, prep ▲2)', () => {
      expectRoundTrip(cacheAudioBlobRowSchema, {
        key: 'sha-legacy',
        audio: new ArrayBuffer(2),
        alignmentData: [{ timeSeconds: 1, charIndex: 7 }],
        createdAt: 1,
        lastAccessed: 1,
      });
    });

    it('round-trips cache_session_state rows with a populated queue', () => {
      expectRoundTrip(cacheSessionStateRowSchema, {
        bookId: 'b-1',
        playbackQueue: [
          { text: 'Hello.', cfi: 'epubcfi(/6/2!/4/2/1:0)', sourceIndices: [0] },
          { text: 'Chapter', cfi: null, isPreroll: true, isSkipped: false, title: 'Ch 1' },
        ],
        lastPauseTime: 1234,
        updatedAt: 5678,
      });
    });

    it('round-trips cache_tts_preparation rows incl. citation markers + extraction version', () => {
      expectRoundTrip(cacheTtsPreparationRowSchema, {
        id: 'b-1-ch1.html',
        bookId: 'b-1',
        sectionId: 'ch1.html',
        sentences: [{ text: 'Hello world.', cfi: 'epubcfi(/6/2!/4/2/1:0)' }],
        citationMarkers: [
          { cfi: 'epubcfi(/6/2!/4/4)', markerText: '1', super: true, numeric: true, glued: false, leading: false, fontSizeRatio: 0.6, targetHref: '#fn1' },
        ],
        extractionVersion: 2,
      });
    });

    it('round-trips cache_render_metrics and cache_table_images rows', () => {
      expectRoundTrip(cacheRenderMetricsRowSchema, { bookId: 'b-1', locations: '{"l":[]}', pageCount: 12 });
      expectRoundTrip(tableImageRowSchema, {
        id: 'b-1-cfi',
        bookId: 'b-1',
        sectionId: 'ch1.html',
        cfi: 'epubcfi(/6/2!/4/8)',
        imageBlob: new ArrayBuffer(6),
      });
    });
  });

  describe('app domain', () => {
    it('round-trips checkpoints rows with and without the additive protected flag', () => {
      const base = { id: 1, timestamp: 1000, blob: new Uint8Array([1, 2, 3]), size: 1, trigger: 'manual' };
      expectRoundTrip(syncCheckpointRowSchema, base);
      expectRoundTrip(syncCheckpointRowSchema, { ...base, protected: true });
      expect(syncCheckpointRowSchema.safeParse({ ...base, blob: [1, 2, 3] }).success).toBe(false);
    });

    it('round-trips the frozen sync_log row shape', () => {
      expectRoundTrip(syncLogEntryRowSchema, { id: 1, timestamp: 2, level: 'warn', message: 'm', details: { a: 1 } });
    });

    it('round-trips flight_snapshots rows', () => {
      expectRoundTrip(flightSnapshotRowSchema, {
        id: 'uuid-1',
        createdAt: 1,
        trigger: 'manual',
        note: '',
        context: { bookId: null, sectionIndex: -1, currentIndex: -1, queueLength: 0, status: 'unknown' },
        eventCount: 0,
        timeRange: { first: 0, last: 0 },
        eventsJSON: '[]',
        sizeBytes: 4,
      });
    });
  });

  describe('untrusted-ingress schemas (backup restore / android payload)', () => {
    it('accepts v3 backup manifest rows (base64 cover) and v2 rows with {} cover garbage', () => {
      expectRoundTrip(backupStaticManifestRowSchema, {
        bookId: 'b-1',
        title: 'T',
        author: 'A',
        coverBlobBase64: 'AAEC',
        anythingElse: 42,
      });
      // v2 reality: JSON.stringify corrupted the binary to {} — the row must
      // still VALIDATE (sanitizeManifestRow strips the garbage afterwards).
      expectRoundTrip(backupStaticManifestRowSchema, { bookId: 'b-2', coverBlob: {} });
    });

    it('rejects backup manifest rows without a bookId', () => {
      expect(backupStaticManifestRowSchema.safeParse({ title: 'No id' }).success).toBe(false);
    });

    it('accepts well-formed locations rows and rejects rows missing the locations string', () => {
      expectRoundTrip(bookLocationsRowSchema, { bookId: 'b-1', locations: '{"x":1}' });
      expect(bookLocationsRowSchema.safeParse({ bookId: 'b-1' }).success).toBe(false);
      expect(bookLocationsRowSchema.safeParse({ bookId: 'b-1', locations: 42 }).success).toBe(false);
    });
  });
});
