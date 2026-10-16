/**
 * src/data/rows — zod schemas for every persisted EpubLibraryDB store.
 *
 * One module per domain, mirroring the schema's three domains:
 *   static.ts — static_manifests, static_resources, static_structure
 *   cache.ts  — cache_render_metrics, cache_audio_blobs,
 *               cache_session_state, cache_tts_preparation,
 *               cache_table_images, cache_search_text, cache_embeddings,
 *               cache_embed_jobs, cache_query_embeddings,
 *               cache_drive_previews
 *   app.ts    — checkpoints, sync_log (frozen), flight_snapshots, and the
 *               app_metadata schema-evolution envelope
 *   backup.ts — the backup-manifest envelope (untrusted restore ingress)
 *
 * Validation runs at untrusted ingress (backup restore rows) and on the
 * Drive-preview cache read (repos/drivePreviews) — never on the other hot
 * read/write paths.
 */
export * from './static';
export * from './cache';
export * from './app';
export * from './backup';
