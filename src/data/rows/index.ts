/**
 * src/data/rows — zod schemas for every persisted EpubLibraryDB store
 * (Phase 3, D4 in plan/overhaul/prep/phase3-storage-gateway.md).
 *
 * One module per domain, mirroring the schema's three domains:
 *   static.ts — static_manifests, static_resources, static_structure
 *   cache.ts  — cache_render_metrics, cache_audio_blobs,
 *               cache_session_state, cache_tts_preparation,
 *               cache_table_images
 *   app.ts    — checkpoints, sync_log (frozen), flight_snapshots, and the
 *               app_metadata schema-evolution envelope (v25, D7)
 *
 * Validation runs at untrusted ingress only (backup restore rows, the
 * android payload read) — never per read/write in production.
 */
export * from './static';
export * from './cache';
export * from './app';
export * from './backup';
