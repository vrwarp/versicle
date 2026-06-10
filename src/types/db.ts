/**
 * @deprecated Phase 1a re-export shim — DO NOT add new imports of this file.
 *
 * types/db.ts (the 934-line god type hub, layering-deps.md LD-1) was
 * dissolved by domain in the Phase 1a type split
 * (plan/overhaul/README.md §Roadmap P1). Import from the domain modules
 * instead:
 *
 *   - ./book            static manifests/resources/structure, legacy Book rows,
 *                        BookMetadata, SectionMetadata, ContentAnalysis
 *   - ./user-data       user_* rows, annotations, lexicon, reading history/list
 *   - ./tts             TTSQueueItem, Timepoint (canonical homes), TTS rows
 *   - ./cache           cache_* rows, CitationMarker, TableImage, BookLocations
 *   - ./flight-recorder FlightEvent, FlightSnapshot
 *   - ./sync            SyncManifest, SyncCheckpoint, SyncLogEntry
 *
 * This shim exists so the ~59 existing importers compile unchanged; the
 * importer migration is deferred to the alias codemod / later phases.
 * DELETION DEADLINE: Phase 9 (deletion & ratchet audit) — master plan
 * §4 rule 2: every temporary shim carries a named deletion deadline.
 */
export type * from './book';
export type * from './user-data';
export type * from './tts';
export type * from './cache';
export type * from './flight-recorder';
export type * from './sync';
