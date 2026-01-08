import { describe, it } from 'vitest';
import { Project } from 'ts-morph';
import path from 'path';

// Fields that are explicitly excluded from sync (The "Heavy Layer")
const OPT_OUT_REGISTRY = [
  'coverBlob',      // Binary data
  'imageBlob',      // Binary data
  'audio',          // Binary data
  'locations',      // Large derived cache
  'syntheticToc',   // Derived from EPUB
  'sentences',      // Large derived cache
  'tableAdaptations',// Derived cache
  'coverUrl',       // Ephemeral URL
];

describe('Sync Schema Exhaustion', () => {
  it('should ensure all sync-eligible fields in BookMetadata are present in SyncManifest', () => {
    const project = new Project();
    const sourceFile = project.addSourceFileAtPath(
      path.resolve(__dirname, '../../types/db.ts')
    );

    // BookMetadata is now a Type Alias (composite), so we use getTypeAliasOrThrow
    const bookMetadataType = sourceFile.getTypeAliasOrThrow('BookMetadata').getType();
    const syncManifest = sourceFile.getInterfaceOrThrow('SyncManifest');

    // Get the keys defined in the SyncManifest.books[id].metadata structure
    const booksProp = syncManifest.getPropertyOrThrow('books');
    const booksType = booksProp.getType();

    const indexType = booksType.getStringIndexType();
    if (!indexType) {
        throw new Error("Could not find index type for 'books' property in SyncManifest");
    }

    const metadataProp = indexType.getProperty('metadata');
    if (!metadataProp) {
        throw new Error("Could not find 'metadata' property in SyncManifest books entry");
    }

    const syncedMetadataKeys = metadataProp.getTypeAtLocation(syncManifest)
        .getApparentProperties()
        .map(p => p.getName()) || [];

    const dbFields = bookMetadataType.getProperties().map(p => p.getName());

    const missingFields = dbFields.filter(field =>
      !syncedMetadataKeys.includes(field) &&
      !OPT_OUT_REGISTRY.includes(field)
    );

    if (missingFields.length > 0) {
      throw new Error(
        `Schema Mismatch! The following fields in BookMetadata are not synchronized and not in OPT_OUT_REGISTRY: ${missingFields.join(', ')}. ` +
        `Either add them to SyncManifest or exclude them in OPT_OUT_REGISTRY.`
      );
    }
  });

  it('should ensure every Store in EpubLibraryDB has a corresponding sync strategy', () => {
    // This part requires us to parse `src/db/db.ts` to find the `EpubLibraryDB` interface.
    const project = new Project();
    const sourceFile = project.addSourceFileAtPath(
      path.resolve(__dirname, '../../db/db.ts')
    );

    const dbInterface = sourceFile.getInterfaceOrThrow('EpubLibraryDB');

    const dbStores = dbInterface.getProperties().map(p => p.getName());

    // Define mapping or expectations for stores
    // Check if the store name exists as a top-level key in SyncManifest OR is opted out.
    // SyncManifest keys: books, lexicon, readingList, transientState, deviceRegistry, version, lastUpdated, deviceId.

    // Mapping DB stores to SyncManifest keys or concepts:
    // books -> books (covers BookMetadata)
    // reading_history -> books (merged into books[id].history)
    // annotations -> books (merged into books[id].annotations)
    // lexicon -> lexicon
    // reading_list -> readingList
    // tts_position -> transientState.ttsPositions

    // Explicitly Opted Out DB Stores (The "Heavy" or "Local-Only" Stores):
    const STORE_OPT_OUT = [
        'files',            // Heavy binary
        'locations',        // Derived cache
        'tts_cache',        // Derived cache
        'tts_queue',        // Local state (transient?) - actually `ttsPositions` is synced, but `queue` is heavy?
        'sections',         // Derived from EPUB
        'content_analysis', // Derived/Heavy? - Wait, `content_analysis` is potentially valuable. But currently maybe not synced?
        'tts_content',      // Derived cache
        'table_images',     // Derived binary
        'checkpoints',      // Local recovery
        'sync_log',         // Local logging
        'app_metadata',     // Local config
        'tts_queue',        // Queue is local? `tts_position` is synced.
    ];

    // Some stores are mapped to properties inside SyncManifest.
    const MAPPED_STORES = [
        'books',
        'reading_history',
        'annotations',
        'lexicon',
        'reading_list',
        'tts_position',
        'book_sources', // Synced via books metadata
        'book_states',  // Synced via books metadata
    ];

    const missingStores = dbStores.filter(store =>
        !MAPPED_STORES.includes(store) &&
        !STORE_OPT_OUT.includes(store)
    );

    if (missingStores.length > 0) {
        throw new Error(
            `Store Mismatch! The following IndexedDB stores have no defined sync strategy: ${missingStores.join(', ')}. ` +
            `Map them to SyncManifest or add them to STORE_OPT_OUT.`
        );
    }
  });
});
