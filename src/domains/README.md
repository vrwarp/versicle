<!-- GENERATED FILE — do not edit by hand. -->
<!-- Rendered by src/app/docs/registryDocs.ts from the live registries. -->
<!-- Drift-gated by src/app/docs/docs.test.ts: a plain `npm test` fails when -->
<!-- this file disagrees with the registries. Regenerate: npm run docs:generate -->

# Domains (L3) — vertical feature modules

Import discipline (master plan §2 rule 3, depcruise `domains-no-store` at
**error**/0): a domain may import `kernel/`, `data/`, its own module,
and other domains' published `index.ts` — never `store/`. Domains
declare `ports.ts` where they need state or platform services; `app/`
injects store-backed adapters (the EngineContext pattern generalized). The
one named carve-out: `store/yjs-provider.ts` for live Y.Doc handles
(checkpoints/inspector), named in the rule comment.

| Domain | What it owns |
| --- | --- |
| `chinese/` | pinyin geometry engine, dictionary (separate versicle-dict IDB), vocabulary |
| `genai/` | GenAIClient contract + GeminiClient/AnthropicClient providers + per-feature zod modules + Gemini text-embedding client |
| `google/` | GoogleAuthClient (per-service tokens), DriveClient/DriveLibrarySync |
| `library/` | ImportOrchestrator job queue, LibraryService (keyed mutex), SHA-256 identity, reingest driver |
| `reader/` | ReaderEngine port (EpubJsEngine = sole epubjs importer), overlays, session recorder |
| `search/` | SearchSession over the search worker + persisted searchText repo |
| `sync/` | SyncBackend port (Firestore or Mock), SyncOrchestrator, workspaces, typed SyncEvent bus |

Published surfaces: `chinese`, `google`, `library`, `search`, and
`sync` export via their `index.ts` (rule 3's cross-domain door —
`sync/index.ts` currently has zero cross-domain consumers and is kept as
the contract surface). `reader` has no barrel: only `app/` composes it
(the composition root's privilege), and no other domain imports it.

**The audio domain is the honest geography exception:** it was rebuilt in
place across Phase 5 and lives at `src/lib/tts/` (engine/, providers/,
pipeline modules) with its app-side adapters at `src/app/tts/` — every
boundary rule applies to it by path-specific lint rules rather than a
`domains/audio/` address. Moving it is pure motion with no behavioral
payoff and was deliberately not done (master plan close-out).
