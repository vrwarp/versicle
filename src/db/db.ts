/**
 * @deprecated Phase 3 (P3-4): the connection and schema moved to the data
 * layer — src/data/connection.ts (open/close, blocked/blocking/terminated
 * handlers, open retry + reset-on-failure, storage.persist()) and
 * src/data/schema.ts (EpubLibraryDB store map + the v24 upgrade callback,
 * byte-identical). This re-export shim keeps the remaining importers
 * compiling until they migrate onto the Phase 3 repos.
 * DELETION DEADLINE: Phase 3 exit (P3-12, with src/db/** and the dbService
 * façade) — plan/overhaul/README.md §4 rule 2.
 */
export type { EpubLibraryDB } from '@data/schema';
export { getConnection as getDB, getConnection as initDB, closeConnection as closeDB } from '@data/connection';
