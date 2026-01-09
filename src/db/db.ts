import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  // New Types
  StaticBookManifest,
  StaticResource,
  StaticStructure,
  UserInventoryItem,
  UserProgress,
  UserAnnotation,
  UserOverrides,
  UserJourneyStep,
  UserAiInference,
  CacheRenderMetrics,
  CacheAudioBlob,
  CacheSessionState,
  CacheTtsPreparation,
  // Old Types for Migration
  BookMetadata,
  BookSource,
  BookState,
  Annotation,
  ReadingHistoryEntry,
  ContentAnalysis,
  BookLocations,
  CachedSegment,
  LexiconRule,
  TTSContent,
  TableImage,
  // App Types
  SyncCheckpoint,
  SyncLogEntry
} from '../types/db';

/**
 * Interface defining the schema for the IndexedDB database.
 * Updated to v18 architecture.
 */
export interface EpubLibraryDB extends DBSchema {
  /**
   * Store for table images (snapshots) extracted during ingestion.
   */
  cache_table_images: {
    key: string;
    value: TableImage;
    indexes: {
      by_bookId: string;
    };
  };
  /**
   * Store for synchronization checkpoints.
   */
  checkpoints: {
    key: number;
    value: SyncCheckpoint;
    indexes: {
      by_timestamp: number;
    };
  };
  /**
   * Store for synchronization logs.
   */
  sync_log: {
    key: number;
    value: SyncLogEntry;
    indexes: {
      by_timestamp: number;
    };
  };
  /**
   * Store for application-level metadata and configuration.
   */
  app_metadata: {
    key: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any;
  };

  // --- DOMAIN 1: STATIC ---
  static_manifests: {
    key: string;
    value: StaticBookManifest;
  };
  static_resources: {
    key: string;
    value: StaticResource;
  };
  static_structure: {
    key: string;
    value: StaticStructure;
  };

  // --- DOMAIN 2: USER ---
  user_inventory: {
    key: string;
    value: UserInventoryItem;
  };
  user_progress: {
    key: string;
    value: UserProgress;
  };
  user_annotations: {
    key: string;
    value: UserAnnotation;
    indexes: {
      by_bookId: string;
    };
  };
  user_overrides: {
    key: string;
    value: UserOverrides;
  };
  user_journey: {
    key: number;
    value: UserJourneyStep;
    indexes: {
      by_bookId: string;
    };
  };
  user_ai_inference: {
    key: string;
    value: UserAiInference;
    indexes: {
      by_bookId: string;
    };
  };

  // --- DOMAIN 3: CACHE ---
  cache_render_metrics: {
    key: string;
    value: CacheRenderMetrics;
  };
  cache_audio_blobs: {
    key: string;
    value: CacheAudioBlob;
  };
  cache_session_state: {
    key: string;
    value: CacheSessionState;
  };
  cache_tts_preparation: {
    key: string;
    value: CacheTtsPreparation;
    indexes: {
      by_bookId: string;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<EpubLibraryDB>>;

export const initDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<EpubLibraryDB>('EpubLibraryDB', 19, {
      async upgrade(db, oldVersion, _newVersion, transaction) {
        // Create New Stores if they don't exist
        const createStore = (name: string, options?: IDBObjectStoreParameters) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (!db.objectStoreNames.contains(name as any)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return db.createObjectStore(name as any, options);
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return transaction.objectStore(name as any);
        };

        // Cache Table Images - New in v19
        // @ts-expect-error - IDBObjectStore type mismatch during migration
        const tableImages = createStore('cache_table_images', { keyPath: 'id' });
        if (!tableImages.indexNames.contains('by_bookId')) {
             tableImages.createIndex('by_bookId', 'bookId');
        }

        // Static
        createStore('static_manifests', { keyPath: 'bookId' });
        createStore('static_resources', { keyPath: 'bookId' });
        createStore('static_structure', { keyPath: 'bookId' });

        // User
        createStore('user_inventory', { keyPath: 'bookId' });
        createStore('user_progress', { keyPath: 'bookId' });

        // @ts-expect-error - IDBObjectStore type mismatch during migration
        const userAnn = createStore('user_annotations', { keyPath: 'id' });
        if (!userAnn.indexNames.contains('by_bookId')) userAnn.createIndex('by_bookId', 'bookId');

        createStore('user_overrides', { keyPath: 'bookId' });

        // @ts-expect-error - IDBObjectStore type mismatch during migration
        const userJourney = createStore('user_journey', { keyPath: 'id', autoIncrement: true });
        if (!userJourney.indexNames.contains('by_bookId')) userJourney.createIndex('by_bookId', 'bookId');

        // @ts-expect-error - IDBObjectStore type mismatch during migration
        const userAi = createStore('user_ai_inference', { keyPath: 'id' });
        if (!userAi.indexNames.contains('by_bookId')) userAi.createIndex('by_bookId', 'bookId');

        // Cache
        createStore('cache_render_metrics', { keyPath: 'bookId' });
        createStore('cache_audio_blobs', { keyPath: 'key' });
        createStore('cache_session_state', { keyPath: 'bookId' });

        // Cache TTS Prep - Added Index for cleanup
        // @ts-expect-error - IDBObjectStore type mismatch during migration
        const ttsPrep = createStore('cache_tts_preparation', { keyPath: 'id' });
        if (!ttsPrep.indexNames.contains('by_bookId')) ttsPrep.createIndex('by_bookId', 'bookId');

        // App Level (Preserve)
        if (!db.objectStoreNames.contains('checkpoints')) {
           const cp = db.createObjectStore('checkpoints', { keyPath: 'id', autoIncrement: true });
           cp.createIndex('by_timestamp', 'timestamp');
        }
        if (!db.objectStoreNames.contains('sync_log')) {
           const sl = db.createObjectStore('sync_log', { keyPath: 'id', autoIncrement: true });
           sl.createIndex('by_timestamp', 'timestamp');
        }
        if (!db.objectStoreNames.contains('app_metadata')) {
           db.createObjectStore('app_metadata');
        }

        // --- MIGRATION LOGIC (v17 -> v18) ---
        if (oldVersion < 18) {
          console.log('Migrating to v18 Data Architecture...');

          // Use 'any' casting for legacy store access within upgrade logic
          // @ts-expect-error - Transaction type casting for legacy stores
          const tx = transaction;

          // 1. Books (Metadata) & Sources & States & Files
          // @ts-expect-error - Legacy store name
          if (db.objectStoreNames.contains('books')) {
             const booksStore = tx.objectStore('books');
             // @ts-expect-error - Legacy store name
             const sourcesStore = db.objectStoreNames.contains('book_sources') ? tx.objectStore('book_sources') : null;
             // @ts-expect-error - Legacy store name
             const statesStore = db.objectStoreNames.contains('book_states') ? tx.objectStore('book_states') : null;
             // @ts-expect-error - Legacy store name
             const filesStore = db.objectStoreNames.contains('files') ? tx.objectStore('files') : null;

             const newManifests = tx.objectStore('static_manifests');
             const newResources = tx.objectStore('static_resources');
             const newStructure = tx.objectStore('static_structure');
             const newInventory = tx.objectStore('user_inventory');
             const newProgress = tx.objectStore('user_progress');

             let cursor = await booksStore.openCursor();
             while (cursor) {
               const book = cursor.value as BookMetadata;

               // Fetch related data
               const source: BookSource = sourcesStore ? await sourcesStore.get(book.id) : {};
               const state: BookState = statesStore ? await statesStore.get(book.id) : {};
               const file: Blob | ArrayBuffer = filesStore ? await filesStore.get(book.id) : null;

               // A. Static Manifest
               await newManifests.put({
                 bookId: book.id,
                 title: book.title,
                 author: book.author,
                 description: book.description,
                 isbn: undefined,
                 fileHash: source.fileHash || 'unknown',
                 fileSize: source.fileSize || 0,
                 totalChars: source.totalChars || 0,
                 schemaVersion: source.version || 1,
                 coverBlob: book.coverBlob // Store cover (thumbnail) in manifest for fast access
               });

               // B. Static Resource
               if (file) {
                   await newResources.put({
                       bookId: book.id,
                       epubBlob: file as Blob
                   });
               }

               // C. Static Structure (Synthetic TOC)
               if (source.syntheticToc) {
                   await newStructure.put({
                       bookId: book.id,
                       toc: source.syntheticToc,
                       spineItems: []
                   });
               }

               // D. User Inventory
               await newInventory.put({
                   bookId: book.id,
                   addedAt: book.addedAt,
                   sourceFilename: source.filename,
                   tags: [],
                   customTitle: undefined,
                   customAuthor: undefined,
                   status: state.progress && state.progress > 0.98 ? 'completed' : (state.progress && state.progress > 0 ? 'reading' : 'unread'),
                   rating: undefined,
                   lastInteraction: state.lastRead || book.addedAt
               });

               // E. User Progress
               await newProgress.put({
                   bookId: book.id,
                   percentage: state.progress || 0,
                   currentCfi: state.currentCfi,
                   lastPlayedCfi: state.lastPlayedCfi,
                   currentQueueIndex: 0,
                   currentSectionIndex: 0,
                   lastRead: state.lastRead || 0,
                   completedRanges: []
               });

               cursor = await cursor.continue();
             }
          }

          // 2. Sections (Spine Items) -> StaticStructure
          if (db.objectStoreNames.contains('sections' as any)) {
              const sectionsStore = tx.objectStore('sections');
              const structureStore = tx.objectStore('static_structure');

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              let cursor = await sectionsStore.openCursor();
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const spineMap = new Map<string, any[]>();

              while (cursor) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const section = cursor.value as any;
                  if (!spineMap.has(section.bookId)) spineMap.set(section.bookId, []);
                  spineMap.get(section.bookId)?.push(section);
                  cursor = await cursor.continue();
              }

              for (const [bookId, sections] of spineMap.entries()) {
                  // Sort by playOrder
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  sections.sort((a: any, b: any) => a.playOrder - b.playOrder);

                  // Update structure
                  const struct = await structureStore.get(bookId);
                  if (struct) {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      struct.spineItems = sections.map((s: any) => ({
                          id: s.sectionId,
                          characterCount: s.characterCount,
                          index: s.playOrder
                      }));
                      await structureStore.put(struct);
                  } else {
                       await structureStore.put({
                           bookId,
                           toc: [],
                           // eslint-disable-next-line @typescript-eslint/no-explicit-any
                           spineItems: sections.map((s: any) => ({
                               id: s.sectionId,
                               characterCount: s.characterCount,
                               index: s.playOrder
                           }))
                       });
                  }
              }
          }

          // 3. Annotations -> UserAnnotations
          if (db.objectStoreNames.contains('annotations' as any)) {
              const oldAnnStore = tx.objectStore('annotations');
              const newAnnStore = tx.objectStore('user_annotations');
              let cursor = await oldAnnStore.openCursor();
              while (cursor) {
                  const ann = cursor.value as Annotation;
                  await newAnnStore.put({
                      id: ann.id,
                      bookId: ann.bookId,
                      cfiRange: ann.cfiRange,
                      text: ann.text,
                      type: ann.type,
                      color: ann.color,
                      note: ann.note,
                      created: ann.created
                  });
                  cursor = await cursor.continue();
              }
          }

          // 4. Lexicon -> UserOverrides
          if (db.objectStoreNames.contains('lexicon' as any)) {
              const lexiconStore = tx.objectStore('lexicon');
              const overridesStore = tx.objectStore('user_overrides');
              let cursor = await lexiconStore.openCursor();
              const rulesMap = new Map<string, LexiconRule[]>();

              while (cursor) {
                  const rule = cursor.value as LexiconRule;
                  const bookId = rule.bookId || 'global';
                  if (!rulesMap.has(bookId)) rulesMap.set(bookId, []);
                  rulesMap.get(bookId)?.push(rule);
                  cursor = await cursor.continue();
              }

              for (const [bookId, rules] of rulesMap.entries()) {
                  await overridesStore.put({
                      bookId,
                      lexicon: rules.map(r => ({
                          id: r.id,
                          original: r.original,
                          replacement: r.replacement,
                          isRegex: r.isRegex,
                          created: r.created
                      })),
                      lexiconConfig: {
                          applyBefore: rules.some(r => r.applyBeforeGlobal)
                      }
                  });
              }
          }

          // 5. Reading History -> UserJourney + UserProgress.completedRanges
          if (db.objectStoreNames.contains('reading_history' as any)) {
              const histStore = tx.objectStore('reading_history');
              const journeyStore = tx.objectStore('user_journey');
              const progressStore = tx.objectStore('user_progress');

              let cursor = await histStore.openCursor();
              while (cursor) {
                  const entry = cursor.value as ReadingHistoryEntry;
                  const bookId = entry.bookId;

                  const progress = await progressStore.get(bookId);
                  if (progress) {
                      progress.completedRanges = entry.readRanges;
                      await progressStore.put(progress);
                  }

                  if (entry.sessions) {
                      for (const session of entry.sessions) {
                          await journeyStore.add({
                              bookId,
                              startTimestamp: session.timestamp,
                              endTimestamp: session.timestamp + 60000,
                              duration: 60,
                              cfiRange: session.cfiRange,
                              type: session.type === 'tts' ? 'tts' : 'visual'
                          });
                      }
                  }
                  cursor = await cursor.continue();
              }
          }

          // 6. Content Analysis -> UserAiInference
          if (db.objectStoreNames.contains('content_analysis' as any)) {
              const caStore = tx.objectStore('content_analysis');
              const aiStore = tx.objectStore('user_ai_inference');

              let cursor = await caStore.openCursor();
              while (cursor) {
                  const ca = cursor.value as ContentAnalysis;
                  await aiStore.put({
                      id: ca.id,
                      bookId: ca.bookId,
                      sectionId: ca.sectionId,
                      semanticMap: ca.contentTypes || [],
                      accessibilityLayers: (ca.tableAdaptations || []).map(t => ({
                          type: 'table-adaptation',
                          rootCfi: t.rootCfi,
                          content: t.text
                      })),
                      summary: ca.summary,
                      structure: ca.structure,
                      generatedAt: ca.lastAnalyzed
                  });
                  cursor = await cursor.continue();
              }
          }

          // 7. Locations -> CacheRenderMetrics
          if (db.objectStoreNames.contains('locations' as any)) {
              const locStore = tx.objectStore('locations');
              const metricsStore = tx.objectStore('cache_render_metrics');
              let cursor = await locStore.openCursor();
              while (cursor) {
                  const loc = cursor.value as BookLocations;
                  await metricsStore.put({
                      bookId: loc.bookId,
                      locations: loc.locations
                  });
                  cursor = await cursor.continue();
              }
          }

          // 8. TTS Cache -> CacheAudioBlobs
          if (db.objectStoreNames.contains('tts_cache' as any)) {
              const cacheStore = tx.objectStore('tts_cache');
              const blobStore = tx.objectStore('cache_audio_blobs');
              let cursor = await cacheStore.openCursor();
              while (cursor) {
                  const seg = cursor.value as CachedSegment;
                  await blobStore.put({
                      key: seg.key,
                      audio: seg.audio,
                      alignmentData: seg.alignment,
                      createdAt: seg.createdAt,
                      lastAccessed: seg.lastAccessed
                  });
                  cursor = await cursor.continue();
              }
          }

           // 9. TTS Content -> CacheTtsPreparation
          if (db.objectStoreNames.contains('tts_content' as any)) {
              const ttsContentStore = tx.objectStore('tts_content');
              const prepStore = tx.objectStore('cache_tts_preparation');
              let cursor = await ttsContentStore.openCursor();
              while (cursor) {
                  const content = cursor.value as TTSContent;
                  await prepStore.put({
                      id: content.id,
                      bookId: content.bookId,
                      sectionId: content.sectionId,
                      sentences: content.sentences
                  });
                  cursor = await cursor.continue();
              }
          }

           // 10. Reading List (Shadow Inventory) -> UserInventory
           if (db.objectStoreNames.contains('reading_list' as any)) {
               const rlStore = tx.objectStore('reading_list');
               let cursor = await rlStore.openCursor();
               while (cursor) {
                   // Just skipping logic as per previous plan to avoid complexity
                   cursor = await cursor.continue();
               }
           }

          // Delete Old Stores
          const oldStores = [
            'books', 'book_sources', 'book_states', 'files',
            'annotations', 'lexicon', 'sections', 'content_analysis',
            'reading_history', 'reading_list', 'tts_queue', 'tts_position',
            'tts_cache', 'locations', 'tts_content', 'table_images'
          ];

          for (const store of oldStores) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              if (db.objectStoreNames.contains(store as any)) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  db.deleteObjectStore(store as any);
              }
          }
        }
      },
    });
  }
  return dbPromise;
};

export const getDB = () => {
  if (!dbPromise) {
    return initDB();
  }
  return dbPromise;
};
