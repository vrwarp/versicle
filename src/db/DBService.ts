/**
 * @deprecated Phase 3 delegating façade. Every method body is a one-line
 * call into the src/data repos that carved this 670-line service apart
 * (plan/overhaul/prep/phase3-storage-gateway.md, D5):
 *
 *   - book/static/cache rows  → @data/repos/bookContent
 *   - cache_audio_blobs       → @data/repos/audioCache
 *   - cache_session_state     → @data/repos/playbackCache
 *
 * Import the repos directly in new code. The façade (and src/db/** with
 * it) is DELETED at Phase 3 exit (P3-12) — master plan §4 rule 2: every
 * temporary shim carries a named deletion deadline.
 */
import type {
  SectionMetadata,
  TableImage,
  BookLocations,
  CacheTtsPreparation,
  TTSState,
  StaticStructure,
  NavigationItem,
  CacheAudioBlob
} from '~types/db';
import type { Timepoint } from '@lib/tts/providers/types';
import type { TTSQueueItem } from '@lib/tts/AudioPlayerService';
import { audioCache } from '@data/repos/audioCache';
import { playbackCache } from '@data/repos/playbackCache';
import { bookContent, type BookIngestData } from '@data/repos/bookContent';

// Relocated VERBATIM to the data layer (P3-4); re-exported here for the
// services that import it off DBService (e.g. BookImportService) until they
// migrate. Dies with the façade at P3-12.
export { handleDbError } from '@data/errors';

// Canonical home is the bookContent repo; re-exported for the importers
// that still type against the façade.
export type { ManifestBundle } from '@data/repos/bookContent';

class DBService {
  // --- Book Operations ---

  getManifestBundleBulk(ids: string[]) {
    return bookContent.getManifestBundleBulk(ids);
  }

  getManifestBundle(id: string) {
    return bookContent.getManifestBundle(id);
  }

  async getBookFile(id: string): Promise<Blob | ArrayBuffer | undefined> {
    return bookContent.getBookFile(id);
  }

  async getSections(bookId: string): Promise<SectionMetadata[]> {
    return bookContent.getSections(bookId);
  }

  async ingestBook(data: BookIngestData, mode: 'add' | 'overwrite' = 'add'): Promise<void> {
    return bookContent.ingest(data, mode);
  }

  async getBookStructure(bookId: string): Promise<StaticStructure | undefined> {
    return bookContent.getBookStructure(bookId);
  }

  async updateBookStructure(bookId: string, toc: NavigationItem[]): Promise<void> {
    return bookContent.updateToc(bookId, toc);
  }

  async deleteBook(id: string): Promise<void> {
    return bookContent.deleteBook(id);
  }

  async offloadBook(id: string): Promise<void> {
    return bookContent.offloadBook(id);
  }

  async restoreBookResource(id: string, epubArrayBuffer: ArrayBuffer): Promise<void> {
    return bookContent.restoreResource(id, epubArrayBuffer);
  }

  async getOffloadedStatus(bookIds?: string[]): Promise<Map<string, boolean>> {
    return bookContent.getOffloadedStatus(bookIds);
  }

  async getAvailableResourceIds(): Promise<Set<string>> {
    return bookContent.getAvailableResourceIds();
  }

  // --- Playback State (→ @data/repos/playbackCache) ---

  async updatePlaybackState(bookId: string, _lastPlayedCfi?: string, lastPauseTime?: number | null): Promise<void> {
    // CFI is no longer persisted here; only lastPauseTime is written.
    if (lastPauseTime === undefined) return;
    return playbackCache.savePauseTime(bookId, lastPauseTime);
  }

  saveTTSState(bookId: string, queue: TTSQueueItem[]): void {
    playbackCache.saveQueue(bookId, queue);
  }

  async flushSessionWrites(): Promise<void> {
    return playbackCache.flushPending();
  }

  async getTTSState(bookId: string): Promise<TTSState | undefined> {
    const session = await playbackCache.getSession(bookId);
    if (!session) return undefined;
    return {
      bookId,
      queue: session.playbackQueue,
      updatedAt: session.updatedAt,
    };
  }

  // --- TTS Cache Operations (→ @data/repos/audioCache) ---

  async getCachedSegment(key: string): Promise<CacheAudioBlob | undefined> {
    return audioCache.getSegment(key);
  }

  async cacheSegment(key: string, audio: ArrayBuffer, alignment?: Timepoint[]): Promise<void> {
    return audioCache.putSegment(key, audio, alignment);
  }

  // --- Locations ---

  async getLocations(bookId: string): Promise<BookLocations | undefined> {
    return bookContent.getLocations(bookId);
  }

  async saveLocations(bookId: string, locations: string): Promise<void> {
    return bookContent.saveLocations(bookId, locations);
  }

  // --- Table Images ---

  async getTableImages(bookId: string): Promise<TableImage[]> {
    return bookContent.getTableImages(bookId);
  }

  // --- Cleanup ---

  cleanup(): void {
    // Drop (never flush) the pending debounced session write — see
    // playbackCache.dropPending for why teardown must not write.
    playbackCache.dropPending();
  }

  // --- TTS Content Operations (For Migration/Caching) ---

  async saveTTSContent(content: CacheTtsPreparation): Promise<void> {
    return bookContent.saveTTSPreparation(content);
  }

  async getTTSContent(bookId: string, sectionId: string): Promise<CacheTtsPreparation | undefined> {
    return bookContent.getTTSPreparation(bookId, sectionId);
  }
}

// Singleton export
export const dbService = new DBService();
