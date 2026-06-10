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
 * hand-roll DBService/useTTSStore mocks — extend the harness instead.
 */
export { resetStore, resetStores, seedStore, autoResetStores } from './stores';
export type { HarnessStore } from './stores';
export { makeDbServiceDouble, makeLibraryDbDouble } from './doubles';
export type { DbServiceShape, PublicOf } from './doubles';
export { captureToasts } from './toastCapture';
export type { CapturedToast, ToastCapture } from './toastCapture';
export { FakeTTSProvider, makeTTSProviderDouble, makeTTSVoice } from './fakeTTSProvider';
export type { FakeTTSProviderOptions } from './fakeTTSProvider';
export { makeInventoryItem, makeBookMetadata, makeTTSQueueItem, makeTTSQueue } from './fixtures';
export { renderWithStores, storeSeed } from './renderWithStores';
export type { RenderWithStoresOptions, RenderWithStoresResult, StoreSeed } from './renderWithStores';
