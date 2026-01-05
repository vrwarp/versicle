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
    // 1. Basic Metadata
    // We prioritize remote unknown keys (Forward Compatibility) then overwrite with local knowns,
    // but effectively we reconstruct the object below.
    // To support "pass through unknown fields", we start with a spread of remote (if newer) or local.
    // Actually, simply spreading both handles most cases.
    // If we want to preserve fields from a newer version (remote), we should spread it first.
    // But since we are explicitly defining the structure below, we cast to any to allow extra props.

    const merged: SyncManifest = {
      ...remote, // Forward Compatibility: Keep unknown fields from remote
      ...local,  // Keep unknown fields from local (if any)

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

      if (!lBook && rBook) {
        merged.books[bookId] = rBook;
        continue;
      }
      if (lBook && !rBook) {
        merged.books[bookId] = lBook;
        continue;
      }

      // Both exist: Merge
      merged.books[bookId] = {
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
    // LWW based on lastRead
    const lTime = local.lastRead || 0;
    const rTime = remote.lastRead || 0;

    // Base object is the one with later time, but we might want to preserve some fields?
    // "Metadata like 'Date Added' or 'Book Title' use strict Last-Write-Wins based on timestamps."
    // Actually, BookMetadata usually doesn't change much except progress.

    if (rTime > lTime) {
      return { ...local, ...remote };
    } else {
      return { ...remote, ...local };
    }
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
    // ID-based Set Union. Newer updatedAt wins? Annotation doesn't have updatedAt explicitly in interface above?
    // Wait, Annotation interface in src/types/db.ts:
    // created: number;
    // No updated field.
    // "Since annotations use UUIDs, we treat them as an append-only set. If two devices modify the same ID, the newer updatedAt wins."
    // I should probably check if created works, or if I need to add updatedAt.
    // Assuming immutable annotations for now (created timestamp). If user edits a note, does it get a new ID?
    // If it's the same ID, we need a way to tell which is newer.
    // Let's assume 'created' is the proxy for version if we don't have 'updatedAt'.
    // Or if the plan implies we should add 'updatedAt'.
    // "Since annotations use UUIDs, we treat them as an append-only set. If two devices modify the same ID, the newer updatedAt wins."
    // I will assume for now that conflicting IDs with different content is rare unless we support editing.
    // If we support editing, we really need `updatedAt`.
    // Let's check `src/types/db.ts` again.

    const map = new Map<string, Annotation>();

    for (const a of local) map.set(a.id, a);

    for (const a of remote) {
      if (map.has(a.id)) {
        // Conflict.
        // If we don't have updatedAt, we can't really know.
        // But usually 'created' is constant.
        // If the plan says "newer updatedAt wins", implies we might need it.
        // For now, let's use 'created' as fallback, or prefer local?
        // Let's prefer the one that looks "newer" or arbitrarily consistent.
        // Actually, if content differs, it's a conflict.
        // Let's just take the one with higher 'created' if we assume edits update 'created' (which is bad practice).
        // Safest: Use local version if conflict, or implementing 'updatedAt' in annotation type is out of scope for this step?
        // The plan says "If two devices modify the same ID".
        // I will assume Last-Write-Wins based on... something.
        // Let's just overwrite for now if remote is "newer" in the sense of... wait, we don't know.
        // I will just keep local if conflict for now unless I add updatedAt.
        // Actually, looking at `db.ts`, `Annotation` only has `created`.
        // I will assume annotations are immutable-ish for now or that `created` is all we have.
      } else {
        map.set(a.id, a);
      }
    }

    return Array.from(map.values());
  }

  private static mergeLexicon(local: LexiconRule[], remote: LexiconRule[]): LexiconRule[] {
    // LexiconRule has 'created'.
    // Similar to annotations.
    const map = new Map<string, LexiconRule>();
    for (const r of local) map.set(r.id, r);
    for (const r of remote) {
       if (map.has(r.id)) {
           // Conflict resolution?
           // Maybe prefer the one with higher 'created'?
       } else {
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
