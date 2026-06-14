# Subsystem analysis: Google integration, Drive & GenAI (`google-genai`)

Analyzed at worktree `/Users/btsai/claude/versicle/.claude/worktrees/amazing-davinci-d7336e` (branch `claude/amazing-davinci-d7336e`). All paths relative to repo root.

## What it is

Three loosely-stacked layers:

1. **Google auth** (`src/lib/google/`): a `GoogleIntegrationManager` singleton that picks a "strategy" (Web vs Android) and wraps `@capgo/capacitor-social-login` to obtain OAuth access tokens per "service" (`drive`, `identity`). Connection *state* (not tokens) is persisted in `useGoogleServicesStore` (localStorage).
2. **Drive** (`src/lib/drive/`, `src/components/drive/`): a thin REST client over Drive v3 (`DriveService`), a scanner/indexer that diffs a linked Drive folder against the local library (`DriveScannerService` + `useDriveStore`), and UI (folder picker, import dialog, browser hook).
3. **GenAI** (`src/lib/genai/`, `src/store/useGenAIStore.ts`, content-analysis stores/UI): a `GenAIService` singleton wrapping `@google/generative-ai` (Gemini) with model-rotation retry, JSON-schema structured output, and four feature methods (smart TOC titles, reference-section detection, table-image-to-narration, reading-list↔library fuzzy mapping). Results of the expensive analyses persist in the Yjs-synced `useContentAnalysisStore`, adapted to the TTS engine through `ContentAnalysisRepository`.

Primary consumers: library import UI, sync settings, TTS `AudioContentPipeline`/`TableAdaptationProcessor` (via the EngineContext `genAI`/`contentAnalysis` ports), `useSmartTOC`, `SmartLinkDialog`.

## File inventory

| File | Lines | Role |
|---|---|---|
| `src/lib/google/GoogleIntegrationManager.ts` | 52 | Singleton facade: picks strategy by platform, mirrors connect/disconnect into `useGoogleServicesStore`, auto-disconnects on token errors. |
| `src/lib/google/WebGoogleAuthStrategy.ts` | 65 | Web token acquisition via `SocialLogin.login`; in-memory token cache with hardcoded 50-min TTL. |
| `src/lib/google/AndroidGoogleAuthStrategy.ts` | 61 | ~95% copy of Web strategy; adds `style: 'bottom'`, `autoSelectEnabled`. |
| `src/lib/google/config.ts` | 29 | `GOOGLE_SERVICES` registry (drive, identity) → scopes; `GoogleLoginOptions` type. |
| `src/lib/drive/DriveService.ts` | 183 | Drive v3 REST client object: `fetchWithAuth` (401 retry), `listFolders`, `listFiles`, `listFilesRecursive`, `getFolderMetadata`, `downloadFile`. |
| `src/lib/drive/DriveScannerService.ts` | 172 | Static class: scan linked folder, build `DriveFileIndex`, diff vs library, `shouldAutoSync` heuristic, `importFile` → `useLibraryStore.addBook`. |
| `src/lib/drive/MockDriveService.ts` | 113 | Hand-rolled in-memory Drive double living in prod source; used by exactly one test (`src/verification/test_drive_sync.test.ts`). |
| `src/components/drive/useDriveBrowser.ts` | 84 | Folder navigation hook (breadcrumbs, race-guarded fetch). |
| `src/components/drive/DriveFolderPicker.tsx` | 171 | Folder picker UI over `useDriveBrowser`. |
| `src/components/drive/DriveImportDialog.tsx` | 196 | Search/import dialog over `useDriveStore.index`. |
| `src/store/useGoogleServicesStore.ts` | 41 | Persisted: `connectedServices[]`, user-overridable Google client IDs. |
| `src/store/useDriveStore.ts` | 83 | Persisted: linked folder, scanned file index, `findFile` heuristic. |
| `src/lib/genai/GenAIService.ts` | 440 | Gemini singleton: configure, log callback, rotation retry, `generateContent`, `generateStructured`, 4 feature prompts. Contains E2E localStorage mock seams. |
| `src/lib/genai/textMatching.ts` | 49 | `findApproximateMatch` fuzzy locator (exact → case-insensitive → whitespace-flexible regex). |
| `src/store/useGenAIStore.ts` | 113 | Persisted (localStorage, `partialize: {...state}`): **apiKey**, model, feature flags, **logs**, usage stats; configures `genAIService` on change/rehydrate. |
| `src/store/useContentAnalysisStore.ts` | 245 | Yjs-synced map `${bookId}/${sectionId}` → `SectionAnalysis` (referenceStartCfi, tableAdaptations, title, status). |
| `src/db/ContentAnalysisRepository.ts` | 52 | Adapter so TTS engine host code reads/writes the Yjs store without bundling Yjs in the worker. |
| `src/types/content-analysis.ts` | 11 | `ContentType = 'reference'` (single variant), `TYPE_COLORS`. |
| `src/components/reader/ContentAnalysisLegend.tsx` | 439 | Debug panel in ReaderView: CFI inspector, table-image carousel, reprocess button, legend. |
| `src/components/reader/ContentAnalysisReport.tsx` | 205 | Per-book report dialog of detected reference starts. |
| `src/components/settings/GenAISettingsTab.tsx` | 283 | Pure presentational settings tab (20 props, wired by `GlobalSettingsDialog`). |
| `src/components/SmartLinkDialog.tsx` | 220 | GenAI-suggested reading-list↔library links; validates model output against inputs. |
| Tests | ~1,000 | `GoogleIntegrationManager.test.ts`, `AndroidGoogleAuthStrategy.test.ts`, `DriveService.pagination.test.ts`, `DriveService.recursive.test.ts`, `DriveScannerService.test.ts`, `DriveLogic.test.ts`, `useDriveBrowser.test.tsx`, `DriveFolderPicker.test.tsx`, `DriveImportDialog.test.tsx`, `GenAIService.test.ts`, `textMatching.test.ts`, plus `src/verification/test_drive_sync.test.ts`. |

## How it works (data & control flow)

### Auth
- `main.tsx:114-131` initializes `SocialLogin` with client IDs from `useGoogleServicesStore` (user-overridable in SyncSettingsTab:593-629) falling back to `VITE_GOOGLE_CLIENT_ID`; re-initializes on store change.
- UI calls `googleIntegrationManager.connectService('drive', loginHint?)` (FileUploader.tsx:162, SyncSettingsTab.tsx:212, ContentMissingDialog.tsx:59). The strategy runs an **interactive** `SocialLogin.login` with `getScopesForService(serviceId)` and caches `{accessToken, expiration=now+50min}` in instance fields. The manager then records `connectService(serviceId)` in the persisted store.
- All Drive REST calls go through `DriveService.fetchWithAuth` → `googleIntegrationManager.getValidToken('drive')`. The manager first checks the *persisted* connected flag, fetches `firebaseUserEmail` from `useSyncStore` as login hint, and delegates. On a 401 the Drive client retries once with `forceRefresh=true` (DriveService.ts:36-40). On **any** error the manager force-disconnects the service (GoogleIntegrationManager.ts:38-43).
- A parallel login path exists in `src/lib/sync/auth-helper.ts:34-39`: Firebase sign-in calls `SocialLogin.login` directly with identity scopes, bypassing the manager/strategy; sign-out loops over `connectedServices` and disconnects each (auth-helper.ts:75-78).

### Drive scan/import
- `App.tsx:225-245`: on boot, if a folder is linked and last scan > 1 week old, `shouldAutoSync()` (compares folder `viewedByMeTime` vs `lastScanTime`) may trigger `scanAndIndex()` in the background.
- `scanAndIndex` → `DriveService.listFilesRecursive(linkedFolderId, 'application/epub+zip')` (serial DFS, one `files.list` per folder, paginated 1000/page) → maps to `DriveFileIndex` → `useDriveStore.setScannedFiles` (persisted to localStorage).
- `DriveImportDialog` searches the cached index client-side; `importFile` downloads the blob and hands a `File` to `useLibraryStore.addBook`. `ContentMissingDialog` uses `useDriveStore.findFile(title, filename)` to offer cloud restore for offloaded/ghost books.

### GenAI
- `useGenAIStore` rehydration (`onRehydrateStorage` → `init()`, useGenAIStore.ts:94-110) configures the `genAIService` singleton with the persisted API key/model/rotation and registers `addLog` as the log callback.
- Every request/response/error is logged via `logCallback` → `useGenAIStore.addLog` → **persisted to localStorage** (partialize spreads the whole state, useGenAIStore.ts:105-107).
- `generateStructured` (GenAIService.ts:163-221): checks localStorage E2E mocks, then runs `executeWithRetry` (rotation across hardcoded `['gemini-2.5-flash-lite','gemini-2.5-flash']` on 429), requests JSON-mode output with a response schema, and does `JSON.parse(text) as T` with no semantic validation.
- TTS pipeline (other subsystem) consumes via EngineContext ports: `createZustandEngineContext.ts:42-55` / `createWorkerEngineClient.ts:175-181` forward `detectContentTypes`/`generateTableAdaptations`/`configure`/`isConfigured` to the singleton on the host thread (GenAI never runs in the worker). Results persist through `contentAnalysisRepository` → `useContentAnalysisStore` (Yjs-synced; `replicationSpec.ts:90-93` mirrors it into the worker).
- `useSmartTOC` (TOC titles) and `SmartLinkDialog` (reading-list mapping) call the singleton directly from React.

## Technical debt

### GG-1. No per-service token isolation: one cached token serves all scopes — **critical / correctness**
**Evidence:** `WebGoogleAuthStrategy.ts:5-6,18-21` and `AndroidGoogleAuthStrategy.ts:5-6,12-15` keep a single `accessToken`/`tokenExpiration` pair per strategy instance; `getValidToken(serviceId, …)` returns the cached token **without checking which serviceId/scopes it was minted for**. `config.ts:14-25` defines two services with disjoint scopes (`drive.readonly` vs `email profile openid`).
**Impact:** If `identity` is ever connected through the manager first (or any future service is added), `getValidToken('drive')` happily returns an identity-scoped token → Drive returns **403 insufficient scopes**, which `fetchWithAuth` does *not* retry (it only handles 401, DriveService.ts:36), so imports/scans fail opaquely. Today it works only by accident because `auth-helper.ts` bypasses the manager for identity. The bug is structural and will fire the moment a second service goes through the manager (e.g. Drive write scope, Calendar, etc.).
**Fix:** Cache tokens keyed by serviceId (or by sorted scope set): `Map<serviceId, {token, expiresAt, scopes}>`. Validate cached scopes ⊇ requested scopes. Add a 403-with-insufficientPermissions retry path in `fetchWithAuth`.

### GG-2. Interactive login popup is the only "refresh" path; background flows can hard-disconnect the user — **critical / correctness**
**Evidence:** Both strategies' `getValidToken` fall through to `SocialLogin.login(...)` (WebGoogleAuthStrategy.ts:34-37) — an interactive popup — whenever the in-memory cache is empty or stale. Tokens are memory-only, so **every page reload empties the cache while `useGoogleServicesStore.connectedServices` still says "connected"** (persisted, useGoogleServicesStore.ts:16-41). `App.tsx:230-238` runs `shouldAutoSync()`/`scanAndIndex()` at boot with no user gesture; on web, the popup gets blocked → error → `GoogleIntegrationManager.getValidToken` catch block **force-disconnects the service on any error** (GoogleIntegrationManager.ts:38-43), including transient network failures and popup-blocking.
**Impact:** Users are silently logged out of Drive after innocuous failures; background scan can pop a login UI with no context or fail and flip persisted state; "connected" UI state is routinely a lie after reload. This is the root of the `ContentMissingDialog` "Please reconnect" flows and the defensive `error.message.includes('is not connected')` string-matching scattered across the scanner.
**Fix:** (a) Distinguish *interactive* (`connect`) from *silent* (`getValidToken`) acquisition; silent path should never open UI — return a typed `AuthRequiredError` instead. (b) Only auto-disconnect on definitive revocation (401/`invalid_grant`), never on network/popup errors. (c) Derive "connected" UI state from token availability + last success, not a persisted boolean.

### GG-3. Gemini API key, full prompts, and base64 table images persisted to localStorage — **high / security + correctness**
**Evidence:** `useGenAIStore.ts:102-110` persists with `partialize: (state) => ({...state})` — i.e. *everything*, including `apiKey` (plaintext) and `logs` (up to `maxLogs=500` entries). `GenAIService.log` records full request payloads: `generateStructured` logs `{ prompt, schema }` (GenAIService.ts:195) and for table adaptation the prompt is `{contents:[{parts:[{inlineData:{data: base64…}}]}]}` (GenAIService.ts:361-378) — entire table images base64-encoded. The settings UI claims "Your key is stored locally on this device" (GenAISettingsTab.tsx:110-112) which is true but understates exposure.
**Impact:** (1) localStorage has a ~5 MB quota; a handful of table-adaptation requests can blow it, and zustand-persist re-serializes the *whole* log array on every `set` — a quadratic write amplification that can freeze the UI and throw `QuotaExceededError`, potentially corrupting the persisted slice (taking the API key down with it). (2) Book content + API key sit in plaintext localStorage, trivially exfiltrated by any XSS (this app ships several forked third-party deps). (3) Logs are debug data; persisting them at all is unnecessary.
**Fix:** Explicit `partialize` allowlist (`apiKey, model, isEnabled, flags…`); keep `logs` in-memory only (or in a capped IndexedDB ring buffer); strip/redact `inlineData` from logged payloads (log byte counts instead); consider storing the key via Capacitor SecureStorage on Android and documenting web limits.

### GG-4. E2E mock seams baked into production code paths, in three places — **high / testing**
**Evidence:** `GenAIService.isConfigured()` returns true if `localStorage.mockGenAIResponse|mockGenAIError` exist (GenAIService.ts:80-86); `generateStructured` short-circuits on those keys with a fake 500 ms delay (GenAIService.ts:167-190); the same check is duplicated in TTS code: `AudioContentPipeline.ts:473` and `TableAdaptationProcessor.ts:77` each include `!!localStorage.getItem('mockGenAIResponse')` inside `canUseGenAI`. Used by `verification/test_journey_smart_toc.spec.ts`.
**Impact:** A stray localStorage key flips the app into "AI configured" mode in production; mock behavior diverges from real behavior (single mock response for *all* methods); the seam leaks into other subsystems, so removing/renaming it requires touching TTS internals. Classic agent-accreted test hook.
**Fix:** Replace with provider injection: a `GenAIClient` interface with `GeminiClient` and `MockClient` implementations, selected once at composition root (behind `import.meta.env.DEV`/test bootstrap), so production code has zero mock awareness.

### GG-5. No validation of structured LLM output; out-of-contract values flow into persisted state — **high / correctness**
**Evidence:** `generateStructured` does `JSON.parse(text) as T` (GenAIService.ts:211) — schema is sent to the API but the response is never checked against it. `detectContentTypes` then computes `startIndex !== -1 && index >= startIndex` (GenAIService.ts:330-334): any negative value other than `-1` (e.g. model returns `-2`) classifies **every** group as `reference`, which is persisted to the Yjs store as `referenceStartCfi` of the first group and causes TTS to skip the entire section. `generateTOCForBatch` and `generateTableAdaptations` trust `id`/`cfi` echo-back without verifying membership (GenAIService.ts:264, 376-394); `mapReadingListToLibrary` returns `result.mappings || []` unvalidated (GenAIService.ts:435-436) — only the *caller* `SmartLinkDialog.tsx:82-87` defends against hallucinated IDs; `useSmartTOC.ts:63-66` and `TableAdaptationProcessor.ts:109-115` do not (unknown ids are silently dropped by Map lookup — benign but invisible).
**Impact:** Single malformed model response can poison synced, cross-device content-analysis state (it's cached and *not* regenerated since status is `success`). Silent data quality drift; debugging requires reading raw logs.
**Fix:** Validate every structured response with zod (or hand-rolled guards) per method: range-check `referenceStartIndex ∈ [-1, n-1]`, verify echoed ids/cfis ∈ input set, clamp/reject otherwise and mark `status:'error'`. Put validation inside `GenAIService` so all consumers inherit it.

### GG-6. Strategy pattern in name only: duplicated strategies, no interface, dead members — **high / architecture + duplication**
**Evidence:** `GoogleIntegrationManager.ts:8` types the field as the union `WebGoogleAuthStrategy | AndroidGoogleAuthStrategy` — there is no `GoogleAuthStrategy` interface. The two classes are ~95% identical (compare WebGoogleAuthStrategy.ts:18-52 with AndroidGoogleAuthStrategy.ts:12-46); the only real differences are two option fields (`style`, `autoSelectEnabled`) and Web's never-called `initialize()` stub (WebGoogleAuthStrategy.ts:8-12). Web's `disconnect()` ignores the `serviceId` the manager passes (WebGoogleAuthStrategy.ts:54 vs GoogleIntegrationManager.ts:47); Web has both `void loginHint` *and* a real use of `loginHint` (WebGoogleAuthStrategy.ts:23,30-32). `getScopesForService` returns `[]` for unknown ids (config.ts:27-29), silently logging in with no scopes.
**Impact:** Every auth fix must be made twice (the test files already diverge: only Android has a strategy test); the missing interface means TypeScript can't catch signature drift (the `disconnect` mismatch already exists); unknown-service typos fail at Google's server instead of locally.
**Fix:** One `interface GoogleAuthStrategy { connect; getValidToken; disconnect }`; collapse to a single `SocialLoginAuthStrategy` taking platform options as constructor args (the @capgo plugin already abstracts the platform); throw on unknown serviceId in `getScopesForService`.

### GG-7. Error taxonomy by message substring — **high / architecture**
**Evidence:** `DriveService` wraps every failure as `new Error(error.error?.message || 'Failed to …: status')` (DriveService.ts:70-71,93-94,134-136,176-178), discarding the HTTP status. Consumers then branch on prose: `error.message.includes('is not connected')` appears at DriveScannerService.ts:27, 51, 99, 163 and App.tsx:234. `GenAIService` rotation detects quota via `error.message?.includes('429') || error.toString().includes('RESOURCE_EXHAUSTED')` (GenAIService.ts:118).
**Impact:** Any wording change in `GoogleIntegrationManager.ts:32` breaks four catch sites silently; status-specific handling (403 scope, 404 folder deleted, 429 rate limit) is impossible; `shouldAutoSync` "defaults to true on error" (DriveScannerService.ts:168-170) because it can't tell error classes apart.
**Fix:** Typed errors: `AuthRequiredError`, `DriveApiError {status, code}`, `GenAIQuotaError`. Throw them at the source; branch with `instanceof`.

### GG-8. `useGenAIStore` is config + debug-log sink + service configurator in one, with config-clobbering writers elsewhere — **medium / architecture**
**Evidence:** Store setters call `genAIService.configure(...)` as a side effect (useGenAIStore.ts:59-71); rehydrate calls `init()` (useGenAIStore.ts:108-110). Meanwhile TTS code *also* calls `configure` with a **hardcoded fallback model and rotation silently reset to false** (`this.ctx.genAI.configure(aiStore.apiKey, 'gemini-1.5-flash')` — AudioContentPipeline.ts:505-507, TableAdaptationProcessor.ts:81-83; the EngineContext port only exposes a 2-arg configure, createZustandEngineClient.ts:50, createWorkerEngineClient.ts:176). `gemini-1.5-flash` is a deprecated model that also doesn't appear in the rotation list.
**Impact:** A TTS-triggered configure can switch a user from their chosen model/rotation to a stale model for all subsequent requests (singleton state), and the store has no idea. Config "truth" lives in two places (store + singleton fields) and they drift.
**Fix:** Make `GenAIService` read its config from a single injected provider (the store) per call instead of holding mutable copies; delete the 2-arg configure from EngineContext; remove the hardcoded fallback model (if not configured, fail with a typed error).

### GG-9. Dead/vestigial code across the subsystem — **medium / dead-code**
**Evidence:**
- `useGenAIStore.usageStats`/`incrementUsage`/`estimatedCost` have zero callers (grep over `src/` returns only the store) — useGenAIStore.ts:21-24,77-83.
- `WebGoogleAuthStrategy.initialize()` never called (WebGoogleAuthStrategy.ts:8-12); `void loginHint` line 23 vestigial.
- `ContentAnalysis.structure.footnoteMatches` is always `[]` — fabricated by the adapter (ContentAnalysisRepository.ts:21) to satisfy a legacy type (types/db.ts:501-504); `summary` field (types/db.ts:509) never written.
- `ContentType` is a single-variant union (`'reference'`, types/content-analysis.ts:1) yet drags generalized machinery: `TYPE_COLORS` map, legend loop (ContentAnalysisLegend.tsx:419-427), filter buttons in `ContentAnalysisReport.tsx:139-150` where `'all'` and `'reference'` produce identical lists (the filter at lines 83-92 always requires `referenceStartCfi`), and the header prints the same count twice ("Found {totalCount} items in {filteredSections.length} sections", line 128, both are `filteredSections.length`).
- `MockDriveService.ts` lives in `src/lib/drive/` (ships in prod tree) and duplicates `listFilesRecursive` verbatim (MockDriveService.ts:83-100 vs DriveService.ts:150-167); used by one test through a hand-built adapter (`src/verification/test_drive_sync.test.ts:11-15`).
- `DriveFolderPicker.tsx:37-38`: `await new Promise(resolve => setTimeout(resolve, 500))` — a fake "Simulate a brief delay for UX".
**Impact:** Noise that misleads future modification (e.g. an engineer "finishing" usageStats or footnoteMatches); single-variant generality suggests features that don't exist.
**Fix:** Delete usageStats (or implement token counting from response metadata), initialize(), footnoteMatches/summary, the fake delay; move MockDriveService under `src/test/`; either collapse ContentType UI to the one real variant or leave a documented extension point — not both.

### GG-10. Serial recursive Drive scan: N+1 requests, no batching, no incremental sync — **medium / performance**
**Evidence:** `listFilesRecursive` does one `listFiles` + one `listFolders` call per folder, awaited sequentially in a `for` loop (DriveService.ts:150-167). A library with 100 nested folders = 200+ serial round trips on app boot (App.tsx:233). Drive v3 supports `'a' in parents or 'b' in parents` queries and `files.list` with `q` across a corpus; no `fields`-level pruning issue, but no `pageSize` tuning either for the folder case. The scan also rebuilds the entire index every time (`setScannedFiles` replaces wholesale, useDriveStore.ts:51-55) instead of using the Drive Changes API.
**Impact:** Slow scans, quota burn, long `isScanning` lockouts in DriveImportDialog; the 1-week/viewedByMeTime heuristic (App.tsx:227-231, DriveScannerService.ts:141-171) exists mostly to paper over scan cost.
**Fix:** Parallelize folder fan-out with a small concurrency pool, batch sibling folders in one query (`'id1' in parents or 'id2' in parents`), and adopt the Changes API with a stored `startPageToken` for incremental updates.

### GG-11. Drive query built by string interpolation — **low / security**
**Evidence:** `` `'${parentId}' in parents …` `` (DriveService.ts:49,105) and mimeType interpolation (line 107). `parentId` comes from Drive API responses or `'root'` today, so exploitability is nil, but a single quote in a future caller-supplied value breaks/alters the query.
**Fix:** Escape `'` → `\'` in a tiny `q`-builder helper; keep ids type-branded.

### GG-12. `getValidToken` reaches into the sync subsystem for a login hint — **medium / architecture (coupling)**
**Evidence:** `GoogleIntegrationManager.ts:5,36` imports `useSyncStore` and reads `firebaseUserEmail` on every token fetch. Meanwhile the *interactive* connect path takes `loginHint` as a parameter (GoogleIntegrationManager.ts:18) and SyncSettingsTab already passes the email explicitly (SyncSettingsTab.tsx:212).
**Impact:** Inverted dependency — the lowest-level auth utility depends on the sync feature store; importing `googleIntegrationManager` anywhere drags in the sync store graph (matters for bundle/worker hygiene and tests, which must mock it).
**Fix:** Make loginHint a constructor-injected provider (`getLoginHint: () => string | undefined`) wired at composition root, or persist the hint inside `useGoogleServicesStore` at connect time.

### GG-13. Two parallel Google sign-in implementations — **medium / duplication**
**Evidence:** `src/lib/sync/auth-helper.ts:34-39` calls `SocialLogin.login({provider:'google', options:{scopes:['email','profile','openid']}})` directly — duplicating the strategies' login flow and the `'offline'` responseType guard (auth-helper.ts:41-43 vs WebGoogleAuthStrategy.ts:39-41) — because the manager's API can't return the `idToken` Firebase needs (manager returns only access tokens, GoogleIntegrationManager.ts:18-27). The `identity` entry in `GOOGLE_SERVICES` (config.ts:20-24) is thus dead weight via the manager path.
**Impact:** Scope/option changes must be coordinated across two files; the plugin's internal session is mutated by a path the manager doesn't know about, making the strategies' cached-token assumptions even shakier.
**Fix:** Extend the strategy contract to return the full credential (`{accessToken, idToken, expiresAt, grantedScopes}`); have auth-helper consume `connect('identity')` from the manager.

### GG-14. 439-line debug panel compiled into the production reader — **medium / hygiene**
**Evidence:** `ContentAnalysisLegend.tsx` is mounted unconditionally in ReaderView (`ReaderView.tsx:1388`), gated only by a runtime flag (`isDebugModeEnabled`, ContentAnalysisLegend.tsx:281). It contains `window.confirm` + `window.location.reload` (lines 266-273), six `as any` casts into epub.js internals (lines 143, 173, 188, 192), blob-URL lifecycle juggling with apologetic comments (lines 72-129), and pulls `reprocessBook` from ingestion. `ContentAnalysisReport` similarly ships always.
**Impact:** Dead bundle weight for every reader session; the reload/reprocess action is one toggle away from end users; heavy untyped epub.js poking is exactly where future epub.js upgrades will silently break.
**Fix:** `React.lazy` the panel behind the debug flag (and ideally behind `import.meta.env.DEV` or a hidden developer toggle); type the epub.js access via a small typed facade shared with the rest of the reader.

### GG-15. Misc consistency/quality gaps — **low / hygiene**
**Evidence:**
- Biased shuffle `[...].sort(() => Math.random() - 0.5)` (GenAIService.ts:104).
- Rotation model list hardcoded in two places: service (GenAIService.ts:38) and settings copy text (GenAISettingsTab.tsx:119); selectable model list hardcodes deprecated `gemini-1.5-flash/pro` (GenAISettingsTab.tsx:137-138) while TTS fallback uses another (`gemini-1.5-flash`).
- `SmartLinkDialog` effect deliberately keyed on `[open]` with eslint-disable (SmartLinkDialog.tsx:99-103) — stale-closure-by-design; re-running on store changes mid-dialog is undefined.
- `GenAILogEntry.payload: any` (GenAIService.ts:27) and `generateStructured(prompt: string | any, schema: any, generationConfigOverride?: any)` (GenAIService.ts:163) — the subsystem's main public API is untyped; `GenAISettingsTab` re-declares its own structurally-identical `GenAILog` interface (GenAISettingsTab.tsx:11-20) instead of importing it.
- `LibraryView.tsx:155-162`: `if (!isDriveConnected) { …getValidToken… } else { …getValidToken… }` — both branches identical, with a comment debating which API to call.
- `useGenAIStore` `ReferenceDetectionStrategy` type is exported *above* the imports (useGenAIStore.ts:1-3); `referenceDetectionStrategy` setting exists but grep shows the TTS pipeline reads it nowhere outside the store (check before deleting — the deterministic shadow telemetry in AudioContentPipeline suggests the toggle was superseded).
- `useDriveStore.findFile` title-containment match (useDriveStore.ts:67-70) will happily match "Dune" to "Dune Messiah.epub" — restore flows (`ContentMissingDialog.tsx:38`) could offer the wrong file; only filename match is reliable.
**Fix:** Fisher-Yates or rotate-by-index; single MODELS constant consumed by service + UI; type the payloads (`unknown` + narrowing); delete duplicated interface; collapse LibraryView branch; verify-and-delete `referenceDetectionStrategy`; require confirmation showing matched filename in restore (already shown in UI — acceptable, but consider similarity scoring).

## Problematic couplings

- **google → sync:** `GoogleIntegrationManager.ts:5,36` reads `useSyncStore.firebaseUserEmail` (GG-12). Auth should not depend on the sync feature.
- **sync → google (parallel path):** `src/lib/sync/auth-helper.ts:9,34` bypasses the manager and drives `SocialLogin` directly, and resets `useGoogleServicesStore` on sign-out (auth-helper.ts:72-94) (GG-13).
- **drive → library/book stores:** `DriveScannerService.ts:3-5,49,126-127` imports `useLibraryStore`, `useBookStore`, `useGoogleServicesStore` and calls `addBook` directly — the scanner is simultaneously API client, indexer, and import orchestrator.
- **TTS → genai internals:** `EngineContext.ts:45` defines `GenAISettingsSnapshot = ReturnType<typeof useGenAIStore.getState>` — the worker protocol's type is literally the whole store shape, so adding a store field changes the engine contract; `AudioContentPipeline.ts:473,505` and `TableAdaptationProcessor.ts:77,82` read `aiStore.apiKey`, the localStorage mock seam, and call `configure` with their own defaults (GG-4, GG-8).
- **reader → analysis store key format:** `ContentAnalysisLegend.tsx:54` and `ContentAnalysisReport.tsx:27-31` re-implement the `${bookId}/` key-prefix parsing instead of going through a selector; the composite-key convention lives in 4+ files (store, repository, legend, report).
- **boot → drive:** `App.tsx:25,225-245` embeds drive auto-sync policy (1-week threshold, error-message sniffing) inline in app bootstrap.

## What's good (keep)

- **Layering of Drive REST (`DriveService`) vs orchestration (`DriveScannerService`) vs UI** is fundamentally right; the REST client is small, paginates correctly (verified by `DriveService.pagination.test.ts`), guards folder cycles (`DriveService.ts:151-155`), and the 401-retry-once wrapper is the correct minimal policy.
- **`useDriveBrowser`** has a proper stale-response guard via request counter (useDriveBrowser.ts:26-47) — a race bug correctly pre-empted.
- **Content-analysis persistence design**: expensive AI results live in the Yjs doc (`useContentAnalysisStore`) so they sync across devices and survive reinstalls; book deletion cleans up (`BookRepository.ts:85`); `ContentAnalysisRepository`'s explicit purpose — keeping Yjs out of the TTS worker bundle — is documented and sound (ContentAnalysisRepository.ts:1-8). The status/lastError/lastAttempt fields enable retry/backoff semantics.
- **`saveTableAdaptations` merge-by-CFI** (useContentAnalysisStore.ts:138-166) is idempotent and CRDT-friendly.
- **Prompt engineering quality** in `detectContentTypes` is genuinely good: asymmetric truncation to cut tokens, sparse flags, deterministic-heuristic hints with forced agree/disagree justification, and telemetry comparing Gemini vs deterministic results (AudioContentPipeline.ts:538-540) — keep the technique, wrap it in validation.
- **Correlation-ID + structured request/response logging** concept (GenAIService.ts:65-78) — the implementation needs redaction/relocation, but the observability instinct is right.
- **`SmartLinkDialog` validates LLM output against its inputs** (SmartLinkDialog.tsx:82-87) — this is the pattern GG-5 wants everywhere.
- **User-overridable Google client IDs** stored in settings with env fallback and live plugin re-init (main.tsx:114-131) — pragmatic for a self-hostable PWA.
- **`textMatching.findApproximateMatch`** is small, escapes regex input, has a sensible exact→insensitive→flexible-whitespace cascade, and is unit-tested.
- **GenAISettingsTab as a pure presentational component** (props in, callbacks out) is easy to test and reuse, despite the prop count.

## Target design

```
src/lib/google/
  GoogleAuthClient.ts        // ONE class wrapping @capgo SocialLogin.
                             //  - tokens: Map<serviceId, {token, idToken?, expiresAt, scopes}>
                             //  - connect(serviceId, {interactive: true})  → full credential
                             //  - getToken(serviceId)                      → silent only; throws AuthRequiredError
                             //  - typed errors: AuthRequiredError | AuthRevokedError | AuthTransientError
  services.ts                // GOOGLE_SERVICES registry; throws on unknown id
  // platform differences = constructor options, not classes

src/lib/drive/
  DriveClient.ts             // REST client; typed DriveApiError{status,reason}; q-builder with escaping;
                             //   batched/concurrent recursive listing; Changes-API incremental sync
  DriveLibrarySync.ts        // scan/index/diff/import orchestration; injected DriveClient + callbacks
                             //   (no direct store imports); boot policy moved here from App.tsx

src/lib/genai/
  GenAIClient.ts             // interface: generateStructured<T>(req, validator) — validator REQUIRED
  GeminiClient.ts            // real impl; config read per-call from injected ConfigProvider (no mutable singleton)
  MockGenAIClient.ts         // test impl, selected at composition root only
  features/                  // tocTitles.ts, referenceDetection.ts, tableAdaptation.ts, libraryMapping.ts
                             //   each = prompt + zod schema + response validation + mapping; pure functions over GenAIClient
  logging.ts                 // in-memory ring buffer, payload redaction (no inlineData), download/export

stores:
  useGoogleServicesStore     // keeps client IDs + last-connected hint; "connected" derived, not authoritative
  useGenAIStore              // config only; explicit partialize allowlist; NO logs, NO apiKey-in-logs
  useContentAnalysisStore    // unchanged (sound); add key helpers exported for reader components
```

Boundary rules: UI and TTS consume `features/*` functions, never the raw client; EngineContext exposes only `detectContentTypes`/`generateTableAdaptations` (drop `configure` from the port); auth errors cross boundaries as types, not strings. Debug UI (`ContentAnalysisLegend`, report) lazy-loaded behind the debug flag.

## Migration notes

No user-data migrations are strictly required — tokens were never persisted, and `useContentAnalysisStore`'s Yjs shape is unchanged. Suggested order, each step shippable:

1. **Safety first (no behavior change):** explicit `partialize` allowlist in `useGenAIStore` + stop persisting `logs` + redact `inlineData` in log payloads (GG-3). On load, existing oversized `genai-storage` entries shrink automatically on first write; add a one-time `localStorage` cleanup that drops a stale `logs` field from the persisted JSON if rehydrate fails (guard against pre-existing quota corruption).
2. **Typed errors** in `DriveService`/`GoogleIntegrationManager`; replace the four `includes('is not connected')` sites and the GenAI 429 sniff (GG-7). Pure refactor, covered by existing scanner tests after assertion updates.
3. **Auth client consolidation** (GG-1, GG-2, GG-6, GG-12, GG-13): introduce `GoogleAuthClient` with per-service token map + silent/interactive split; keep `googleIntegrationManager` as a thin deprecated alias during the transition so the 6 call sites (FileUploader, LibraryView, SyncSettingsTab, ContentMissingDialog, auth-helper, DriveService) migrate one PR at a time. Persisted `connectedServices` stays as a *hint* ("user has connected before") used only to decide whether silent failure should show a "reconnect" affordance instead of auto-popup. Verify on Android: @capgo plugin behavior for repeated `login` calls with different scopes.
4. **GenAI response validation** (GG-5): add zod schemas inside the four feature methods; clamp `referenceStartIndex`; on validation failure mark `markAnalysisError` so the existing status/retry machinery handles it. Existing persisted analyses remain valid.
5. **GenAI config unification** (GG-8): per-call config provider; delete `configure` from EngineContext ports (update `createZustandEngineContext.ts`, `createWorkerEngineClient.ts`, both pipeline call sites); remove hardcoded `gemini-1.5-flash` fallbacks.
6. **Mock seam extraction** (GG-4): introduce `MockGenAIClient` selected in a test bootstrap; update `verification/test_journey_smart_toc.spec.ts` to install it (e.g. via a dev-only `window.__setGenAIMock` exposed by the composition root in non-prod builds); then delete all three `mockGenAIResponse` checks.
7. **Drive scan performance** (GG-10): concurrency pool + multi-parent queries first (drop-in), Changes API second (needs a stored `startPageToken` in `useDriveStore` — additive persisted field, no migration).
8. **Cleanup pass** (GG-9, GG-14, GG-15): delete dead members, move `MockDriveService` to test tree, lazy-load debug panels, dedupe model lists, fix the double-count header in `ContentAnalysisReport`.

Test strategy: the existing per-file regression tests (pagination, recursive, 401-retry, rotation) encode real invariants — port their assertions onto the new clients rather than deleting them; collapse `DriveLogic.test.ts`/`useDriveBrowser.test.tsx`/`DriveService.*.test.ts` overlap into one `DriveClient` spec + one browser-hook spec.
