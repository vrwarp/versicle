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
    // Phase 1a type split: the declarations live in the domain modules
    // (types/book.ts, types/sync.ts, ...). The types/db.ts re-export shim
    // met its named P9 deletion deadline and is gone.
    const bookFile = project.addSourceFileAtPath(
      path.resolve(__dirname, '../../types/book.ts')
    );
    const syncFile = project.addSourceFileAtPath(
      path.resolve(__dirname, '../../types/sync.ts')
    );
    // Pull in the cross-module type imports (book/user-data/tts) so that
    // SyncManifest's Partial<BookMetadata> resolves to real properties.
    project.resolveSourceFileDependencies();

    // BookMetadata is now a Type Alias (composite), so we use getTypeAliasOrThrow
    const bookMetadataType = bookFile.getTypeAliasOrThrow('BookMetadata').getType();
    const syncManifest = syncFile.getInterfaceOrThrow('SyncManifest');

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
    const project = new Project();
    // P3-4: the EpubLibraryDB interface moved from src/db/db.ts (now a
    // re-export shim) to the data layer's schema module.
    const sourceFile = project.addSourceFileAtPath(
      path.resolve(__dirname, '../../data/schema.ts')
    );

    const dbInterface = sourceFile.getInterfaceOrThrow('EpubLibraryDB');
    const dbStores = dbInterface.getProperties().map(p => p.getName());

    // Explicitly Opted Out DB Stores (The "Heavy" or "Local-Only" Stores):
    const STORE_OPT_OUT = [
        // Static Domain
        'static_manifests', // Heavy/Immutable
        'static_resources', // Heavy Binary
        'static_structure', // Heavy/Derived

        // Cache Domain
        'cache_render_metrics',
        'cache_audio_blobs',
        'cache_session_state',
        'cache_tts_preparation',
        'cache_table_images',
        'cache_search_text', // v26 (Phase 7 §F): local, rebuildable search corpus
        'cache_embeddings',  // v27: local, rebuildable embedding vectors (device-local, never synced)
        'cache_embed_jobs',  // v27: local, resumable embedding-job progress (device-local, never synced)
        'cache_query_embeddings', // v29: local, cached query embedding vectors (device-local, never synced)
        'cache_drive_previews', // v31: local, rebuildable Drive metadata/cover previews (device-local, never synced)

        // App Level
        'checkpoints',      // Local recovery
        'sync_log',         // Local logging
        'app_metadata',     // Local config
        'flight_snapshots', // Local diagnostics
    ];

    // Some stores are mapped to properties inside SyncManifest.
    const MAPPED_STORES = [
        'user_inventory',   // Mapped to books.metadata
        'user_reading_list',// Mapped to readingList
        'user_progress',    // Mapped to books.metadata + history
        'user_annotations', // Mapped to books.annotations
        'user_overrides',   // Mapped to lexicon
        'user_journey',     // Mapped to books.history.sessions
        'user_ai_inference' // Mapped to books.aiInference
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
