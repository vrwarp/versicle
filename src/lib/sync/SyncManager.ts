import type { SyncManifest, BookMetadata, ReadingHistoryEntry, Annotation, LexiconRule, ReadingListEntry, TTSPosition } from '../../types/db';
import { mergeCfiRanges } from '../cfi-utils';

export class SyncManager {
  /**
   * Merges a remote manifest into the local manifest.
   * Resolves conflicts using Last-Write-Wins (LWW) and CFI Unions.
   *
   * @param local The current local manifest (the "Truth" before merge).
   * @param remote The remote manifest retrieved from cloud.
   * @returns A new merged manifest.
   */
  static mergeManifests(local: SyncManifest, remote: SyncManifest): SyncManifest {
    const merged: SyncManifest = {
      ...remote,
      ...local,
      // Explicitly overwrite known fields with merged results
      version: Math.max(local.version, remote.version),
      lastUpdated: Date.now(),
      deviceId: local.deviceId,
      books: {},
      lexicon: [],
      readingList: {},
      transientState: {
        ...remote.transientState, // Preserve unknown transient state
        ...local.transientState,
        ttsPositions: {}
      },
      deviceRegistry: { ...local.deviceRegistry, ...remote.deviceRegistry }
    };

    // 2. Merge Books
    const allBookIds = new Set([...Object.keys(local.books), ...Object.keys(remote.books)]);
    for (const bookId of allBookIds) {
      const lBook = local.books[bookId];
      const rBook = remote.books[bookId];

      if (!lBook) { merged.books[bookId] = rBook; continue; }
      if (!rBook) { merged.books[bookId] = lBook; continue; }

      // Both exist: Merge
      merged.books[bookId] = {
        ...rBook,
        ...lBook,
        metadata: this.mergeBookMetadata(lBook.metadata, rBook.metadata),
        history: this.mergeReadingHistory(lBook.history, rBook.history),
        annotations: this.mergeAnnotations(lBook.annotations, rBook.annotations)
      };
    }

    // 3. Merge Lexicon (LWW by ID)
    merged.lexicon = this.mergeLexicon(local.lexicon, remote.lexicon);

    // 4. Merge Reading List (LWW by filename)
    merged.readingList = this.mergeReadingList(local.readingList, remote.readingList);

    // 5. Merge Transient State (TTS Positions)
    merged.transientState.ttsPositions = this.mergeTTSPositions(
      local.transientState.ttsPositions,
      remote.transientState.ttsPositions
    );

    return merged;
  }

  private static mergeBookMetadata(local: Partial<BookMetadata>, remote: Partial<BookMetadata>): Partial<BookMetadata> {
    const lTime = local.lastRead || 0;
    const rTime = remote.lastRead || 0;

    // LWW based on lastRead, but preserving unknown fields
    return rTime > lTime ? { ...local, ...remote } : { ...remote, ...local };
  }

  private static mergeReadingHistory(local: ReadingHistoryEntry, remote: ReadingHistoryEntry): ReadingHistoryEntry {
    // Union of readRanges
    const combinedRanges = mergeCfiRanges(local.readRanges, undefined); // Normalize local
    const remoteRanges = mergeCfiRanges(remote.readRanges, undefined); // Normalize remote

    // To merge them, we just combine and re-merge
    const mergedRanges = mergeCfiRanges([...combinedRanges, ...remoteRanges]);

    // Sessions: Union by timestamp + type?
    // Usually we just append them. But to avoid duplicates, we could key by timestamp+type.
    // For simplicity, let's concat and dedupe by timestamp (assuming high precision).
    const sessionMap = new Map();
    for (const s of local.sessions) sessionMap.set(`${s.timestamp}-${s.type}`, s);
    for (const s of remote.sessions) sessionMap.set(`${s.timestamp}-${s.type}`, s);

    const mergedSessions = Array.from(sessionMap.values()).sort((a, b) => a.timestamp - b.timestamp);

    return {
      bookId: local.bookId,
      readRanges: mergedRanges,
      sessions: mergedSessions,
      lastUpdated: Math.max(local.lastUpdated, remote.lastUpdated)
    };
  }

  private static mergeAnnotations(local: Annotation[], remote: Annotation[]): Annotation[] {
    const map = new Map<string, Annotation>();

    for (const a of local) map.set(a.id, a);

    for (const a of remote) {
      if (!map.has(a.id)) {
        map.set(a.id, a);
      }
      // If conflict, we currently prioritize local (by initializing with local and ignoring remote if present)
      // This is a simplification as per current requirements.
    }

    return Array.from(map.values());
  }

  private static mergeLexicon(local: LexiconRule[], remote: LexiconRule[]): LexiconRule[] {
    const map = new Map<string, LexiconRule>();
    for (const r of local) map.set(r.id, r);
    for (const r of remote) {
       if (!map.has(r.id)) {
           map.set(r.id, r);
       }
    }
    return Array.from(map.values());
  }

  private static mergeReadingList(
    local: Record<string, ReadingListEntry>,
    remote: Record<string, ReadingListEntry>
  ): Record<string, ReadingListEntry> {
    const merged = { ...local };
    for (const [key, val] of Object.entries(remote)) {
        if (merged[key]) {
            if (val.lastUpdated > merged[key].lastUpdated) {
                merged[key] = val;
            }
        } else {
            merged[key] = val;
        }
    }
    return merged;
  }

  private static mergeTTSPositions(
    local: Record<string, TTSPosition>,
    remote: Record<string, TTSPosition>
  ): Record<string, TTSPosition> {
      const merged = { ...local };
      for (const [key, val] of Object.entries(remote)) {
          if (merged[key]) {
              if (val.updatedAt > merged[key].updatedAt) {
                  merged[key] = val;
              }
          } else {
              merged[key] = val;
          }
      }
      return merged;
  }
}
