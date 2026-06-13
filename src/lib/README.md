# lib/ — the honest legacy-geography residual

Business logic that predates the overhaul's vertical-domain geography and
was rebuilt **in place** rather than relocated (relocation is pure motion
with no behavioral payoff — see `src/domains/README.md` and the master-plan
close-out). Every boundary rule still applies here by path-specific lint
and dependency-cruiser rules; the `lib-not-to-store` ratchet (19 frozen
edges) is this directory's debt meter.

## The audio domain

*   **`tts/`** — the complete TTS architecture (Phase 5 rebuild): the
    engine (`tts/engine/` — PlaybackController, QueueModel, parity-tested
    on both transports), the provider registry (`tts/providers/` — see its
    README), LexiconEngine, SectionQueueBuilder, TextSegmenter, TTSCache,
    platform/media-session integration. App-side adapters: `src/app/tts/`.

## Services

*   **`BackupService.ts`** — manifest-v3 backups: validate-before-destroy,
    pre-restore checkpoint (round-trip suite alongside).
*   **`MaintenanceService.ts`** — orphan scan/repair over the data repos.
*   **`ingestion.ts` + `ingestion/`** — EPUB import parsing and the C8
    sentence-extraction artifact (`ingestion/sentence-extraction.ts`,
    extraction v3, raw-at-rest).
*   **`sanitizer.ts`** — the sanitize-at-serialize XSS boundary (strips
    remote EPUB resources; CSP is the second layer).
*   **`search-engine.ts`** — the escaped-literal scan engine hosted by
    `workers/search.worker.ts`; the session/UI side lives in
    `src/domains/search/`.
*   **`sync/`** — firebase config/presence helpers + the C3 SyncBackend
    contract suites (mock + emulator); the sync domain itself is
    `src/domains/sync/`.
*   **`genai/`** — text-matching helpers for GenAI features; clients live
    in `src/domains/google/`.
*   **`reader/`** — title resolution helpers for the reader.

## Utilities

Small single-purpose modules: `utils.ts` (incl. the `cn` Tailwind merge
helper), `crypto.ts`, `csv.ts`, `device-id.ts`, `language-utils.ts`,
`logger.ts`, `cover-palette.ts`, `entity-resolution.ts`, `json-diff.ts`,
`cancellable-task-runner.ts`, `export.ts`/`export-notes.ts`,
`serviceWorkerUtils.ts`, `constants.ts`.
