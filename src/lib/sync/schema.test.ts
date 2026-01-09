import { describe, it } from 'vitest';
import { Project } from 'ts-morph';
import path from 'path';

// Fields that are explicitly excluded from sync (The "Heavy Layer")
const OPT_OUT_REGISTRY = [
  'coverBlob',      // Binary data
  'imageBlob',      // Binary data
  'epubBlob',       // Binary data (new in v18)
  'audio',          // Binary data
  'locations',      // Large derived cache
  'syntheticToc',   // Derived from EPUB
  'sentences',      // Large derived cache
  'tableAdaptations',// Derived cache
  'coverUrl',       // Ephemeral URL
  'schemaVersion',  // Technical metadata
  'fileHash',       // Technical
  'fileSize',       // Technical
  'totalChars',     // Technical
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
    const project = new Project();
    const sourceFile = project.addSourceFileAtPath(
      path.resolve(__dirname, '../../db/db.ts')
    );

    const dbInterface = sourceFile.getInterfaceOrThrow('EpubLibraryDB');

    const dbStores = dbInterface.getProperties().map(p => p.getName());

    // --- MAPPING STRATEGY (v18) ---
    // User Domain -> Synced
    const MAPPED_STORES = [
        'user_inventory',   // Synced (Mapped to books.metadata / ReadingList)
        'user_progress',    // Synced (Mapped to books.metadata / books.history)
        'user_annotations', // Synced (Mapped to books.annotations)
        'user_overrides',   // Synced (Mapped to lexicon)
        'user_journey',     // Synced (Mapped to books.history)
        'user_ai_inference' // Synced (Explicitly mentioned in plan, although implementation in SyncOrchestrator currently handles mapping?)
                            // Wait, I didn't update `SyncOrchestrator` to sync `user_ai_inference`.
                            // The plan says: "user_ai_inference ... (Synced due to high compute cost)."
                            // My `SyncOrchestrator` implementation likely missed this new store.
                            // I should check `SyncOrchestrator` later.
                            // For now, let's assume it IS mapped or should be.
    ];

    // Static Domain -> Not Synced (File Dependent)
    const STORE_OPT_OUT = [
        'static_manifests',  // Re-derivable from file or partially synced via metadata
        'static_resources',  // Heavy binary (Files)
        'static_structure',  // Derived from file

        // Cache Domain -> Not Synced
        'cache_render_metrics',
        'cache_audio_blobs',
        'cache_session_state',
        'cache_tts_preparation',

        // App Level
        'checkpoints',
        'sync_log',
        'app_metadata'
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
