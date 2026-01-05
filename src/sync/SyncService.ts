import type { SyncManifest } from './types';
import type { RemoteStorageProvider } from './RemoteStorageProvider';
import { getDB } from '../db/db';
import type { ReadingHistoryEntry, Annotation, LexiconRule, BookMetadata, TTSPosition, ReadingListEntry } from '../types/db';

export class SyncService {
  private provider: RemoteStorageProvider;
  private deviceId: string;
  private isSyncing = false;

  constructor(provider: RemoteStorageProvider, deviceId: string) {
    this.provider = provider;
    this.deviceId = deviceId;
  }

  async sync(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      if (!this.provider.isAuthorized()) {
        console.warn('SyncService: Not authorized');
        return;
      }

      const localState = await this.getLocalState();
      const remoteResult = await this.provider.getManifest();

      if (!remoteResult) {
        // No remote manifest, push local state
        const initialManifest = this.createManifest(localState);
        await this.provider.updateManifest(initialManifest, '');
        await this.logSync('push', 'success');
      } else {
        const { data: remoteManifest, etag } = remoteResult;

        // Merge strategy
        const mergedManifest = await this.mergeStates(localState, remoteManifest);

        // Update local state
        await this.applyStateToLocal(mergedManifest);

        // Push merged state back to remote
        try {
            await this.provider.updateManifest(mergedManifest, etag);
            await this.logSync('merge', 'success');
        } catch (error) {
            // Handle conflict (412) by retrying?
            // For now just log
             await this.logSync('merge', 'conflict', error instanceof Error ? error.message : 'Unknown error');
             // In a real scenario, we would re-fetch and re-merge
        }
      }
    } catch (error) {
      console.error('Sync failed:', error);
      await this.logSync('error', 'failure', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      this.isSyncing = false;
    }
  }

  private async getLocalState() {
    const db = await getDB();
    const books = await db.getAll('books');
    const readingHistory = await db.getAll('reading_history');
    const annotations = await db.getAll('annotations');
    const lexicon = await db.getAll('lexicon');
    const readingList = await db.getAll('reading_list');
    const ttsPositions = await db.getAll('tts_position');

    return { books, readingHistory, annotations, lexicon, readingList, ttsPositions };
  }

  private createManifest(localState: any): SyncManifest {
    const manifest: SyncManifest = {
      version: 1,
      lastUpdated: Date.now(),
      deviceId: this.deviceId,
      books: {},
      lexicon: localState.lexicon,
      readingList: {},
      transientState: {
        ttsPositions: {},
      },
      deviceRegistry: {
        [this.deviceId]: {
          name: 'Current Device', // TODO: Get real device name
          lastSeen: Date.now(),
        }
      }
    };

    // Populate books map
    for (const book of localState.books as BookMetadata[]) {
        manifest.books[book.id] = {
            metadata: {
                // Only sync essential metadata
                id: book.id,
                title: book.title,
                author: book.author,
                lastRead: book.lastRead,
                progress: book.progress,
                currentCfi: book.currentCfi,
                lastPlayedCfi: book.lastPlayedCfi,
                lastPauseTime: book.lastPauseTime,
                addedAt: book.addedAt
            },
            history: (localState.readingHistory as ReadingHistoryEntry[]).find(h => h.bookId === book.id) || {
                bookId: book.id,
                readRanges: [],
                sessions: [],
                lastUpdated: 0
            },
            annotations: (localState.annotations as Annotation[]).filter(a => a.bookId === book.id)
        };
    }

    // Populate reading list
    for (const entry of localState.readingList) {
        manifest.readingList[entry.filename] = entry;
    }

     // Populate TTS positions
     for (const pos of localState.ttsPositions as TTSPosition[]) {
        manifest.transientState.ttsPositions[pos.bookId] = pos;
    }

    return manifest;
  }

  private async mergeStates(local: any, remote: SyncManifest): Promise<SyncManifest> {
    const merged = JSON.parse(JSON.stringify(remote)) as SyncManifest;

    merged.lastUpdated = Date.now();
    merged.deviceId = this.deviceId;
    merged.deviceRegistry[this.deviceId] = {
        name: 'Current Device',
        lastSeen: Date.now()
    };

    // Merge Books
    const localBooks = local.books as BookMetadata[];
    for (const localBook of localBooks) {
        const remoteBook = merged.books[localBook.id];
        if (!remoteBook) {
            // New book on local
             merged.books[localBook.id] = {
                metadata: {
                    id: localBook.id,
                    title: localBook.title,
                    author: localBook.author,
                    lastRead: localBook.lastRead,
                    progress: localBook.progress,
                    currentCfi: localBook.currentCfi,
                    lastPlayedCfi: localBook.lastPlayedCfi,
                    lastPauseTime: localBook.lastPauseTime,
                    addedAt: localBook.addedAt
                },
                history: (local.readingHistory as ReadingHistoryEntry[]).find((h: ReadingHistoryEntry) => h.bookId === localBook.id) || {
                    bookId: localBook.id,
                    readRanges: [],
                    sessions: [],
                    lastUpdated: 0
                },
                annotations: (local.annotations as Annotation[]).filter((a: Annotation) => a.bookId === localBook.id)
            };
        } else {
            // Merge metadata (LWW)
            if ((localBook.lastRead || 0) > (remoteBook.metadata.lastRead || 0)) {
                remoteBook.metadata = { ...remoteBook.metadata, ...{
                     lastRead: localBook.lastRead,
                     progress: localBook.progress,
                     currentCfi: localBook.currentCfi,
                     lastPlayedCfi: localBook.lastPlayedCfi,
                     lastPauseTime: localBook.lastPauseTime
                }};
            }

            // Merge Annotations (Union by ID)
            const localAnnos = (local.annotations as Annotation[]).filter(a => a.bookId === localBook.id);
            const mergedAnnos = [...remoteBook.annotations];

            for (const localAnno of localAnnos) {
                const existingIndex = mergedAnnos.findIndex(a => a.id === localAnno.id);
                if (existingIndex === -1) {
                    mergedAnnos.push(localAnno);
                } else {
                    // If exists, prefer newer created/updated?
                    // Annotations are usually immutable, but let's assume LWW on text content if modified?
                    // For now, assume ID collision means same annotation.
                }
            }
            remoteBook.annotations = mergedAnnos;

            // Merge Reading History (Union of Ranges - simplified for now)
            // TODO: Implement actual range merging logic
            const localHistory = (local.readingHistory as ReadingHistoryEntry[]).find(h => h.bookId === localBook.id);
            if (localHistory) {
                 // Basic union of arrays (not merging overlaps yet)
                 remoteBook.history.readRanges = Array.from(new Set([...remoteBook.history.readRanges, ...localHistory.readRanges]));
                 // Sort sessions by timestamp
                 remoteBook.history.sessions = [...remoteBook.history.sessions, ...localHistory.sessions]
                    .sort((a, b) => a.timestamp - b.timestamp)
                    .filter((item, index, self) => index === self.findIndex(t => t.timestamp === item.timestamp)); // Dedupe by timestamp

                 remoteBook.history.lastUpdated = Math.max(remoteBook.history.lastUpdated, localHistory.lastUpdated);
            }
        }
    }

    // Merge Lexicon (Union by ID)
    const localLexicon = local.lexicon as LexiconRule[];
    const mergedLexicon = [...merged.lexicon];
    for (const rule of localLexicon) {
         const existingIndex = mergedLexicon.findIndex(r => r.id === rule.id);
         if (existingIndex === -1) {
             mergedLexicon.push(rule);
         }
    }
    merged.lexicon = mergedLexicon;

    // Merge Reading List (LWW)
    const localReadingList = local.readingList as ReadingListEntry[];
    for (const entry of localReadingList) {
        const remoteEntry = merged.readingList[entry.filename];
        if (!remoteEntry || entry.lastUpdated > remoteEntry.lastUpdated) {
            merged.readingList[entry.filename] = entry;
        }
    }

    // Merge TTS Positions (Latest Wins)
    const localTTS = local.ttsPositions as TTSPosition[];
    for (const pos of localTTS) {
        const remotePos = merged.transientState.ttsPositions[pos.bookId];
        if (!remotePos || pos.updatedAt > remotePos.updatedAt) {
            merged.transientState.ttsPositions[pos.bookId] = pos;
        }
    }

    return merged;
  }

  private async applyStateToLocal(manifest: SyncManifest): Promise<void> {
      const db = await getDB();
      const tx = db.transaction(['books', 'reading_history', 'annotations', 'lexicon', 'reading_list', 'tts_position'], 'readwrite');

      // Update Books & History & Annotations
      for (const [bookId, data] of Object.entries(manifest.books)) {
          const localBook = await tx.objectStore('books').get(bookId);
          if (localBook) {
              // Update metadata if remote is newer
              if ((data.metadata.lastRead || 0) > (localBook.lastRead || 0)) {
                  await tx.objectStore('books').put({ ...localBook, ...data.metadata });
              }
          } else {
              // New book from remote (metadata only)
              // We construct a BookMetadata object from the partial metadata
              // We must ensure required fields are present or have defaults
              const newBook = data.metadata as BookMetadata;
              if (newBook.id && newBook.title && newBook.author) { // minimal validation
                   // Mark as offloaded since we don't have the file
                   newBook.isOffloaded = true;
                   // Use remote addedAt or current time
                   newBook.addedAt = newBook.addedAt || Date.now();
                   await tx.objectStore('books').put(newBook);
              }
          }

          // Update History
          await tx.objectStore('reading_history').put(data.history);

          // Update Annotations
          for (const anno of data.annotations) {
              await tx.objectStore('annotations').put(anno);
          }
      }

      // Update Lexicon
      for (const rule of manifest.lexicon) {
          await tx.objectStore('lexicon').put(rule);
      }

      // Update Reading List
      for (const [, entry] of Object.entries(manifest.readingList)) {
           await tx.objectStore('reading_list').put(entry);
      }

      // Update TTS Positions
      for (const [, pos] of Object.entries(manifest.transientState.ttsPositions)) {
          await tx.objectStore('tts_position').put(pos);
      }

      await tx.done;
  }

  private async logSync(type: 'push' | 'pull' | 'merge' | 'error', status: 'success' | 'failure' | 'conflict', details?: string) {
      const db = await getDB();
      await db.put('sync_log', {
          timestamp: Date.now(),
          type,
          status,
          details,
          deviceId: this.deviceId
      });
  }
}
