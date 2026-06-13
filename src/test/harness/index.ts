/**
 * Shared test harness (Phase 0, plan/overhaul/README.md §7).
 *
 * One import for the patterns that replace per-file `vi.mock` piles:
 *
 *   - real-store seeding/reset            → ./stores
 *   - typed service doubles (db seams)    → ./doubles
 *   - toast capture through the real store→ ./toastCapture
 *   - ITTSProvider double                 → ./fakeTTSProvider
 *   - typed domain fixtures               → ./fixtures
 *   - renderWithStores (component tests)  → ./renderWithStores
 *
 * Rule of thumb: prefer a DI seam + double from here over `vi.mock`; prefer
 * seeding the real store over re-declaring its shape. New tests should not
 * hand-roll repo/useTTSStore mocks — extend the harness instead.
 */
export { runAxe } from './axe';
export { resetStore, seedStore, autoResetStores } from './stores';
export { makeBookContentDouble, makeLibraryPersistenceDouble } from './doubles';
export { captureToasts } from './toastCapture';
export { FakeTTSProvider, makeTTSVoice } from './fakeTTSProvider';
export { makeInventoryItem, makeBookMetadata, makeTTSQueue } from './fixtures';
export { makeTestLibrary, makeFullExtraction } from './library';
export { renderWithStores, storeSeed } from './renderWithStores';
