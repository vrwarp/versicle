# Privacy posture: data-egress map and network boundary architecture

Subsystem key: `gap-privacy-posture-data-egress-ma`
Analyzed: 2026-06-10. All paths relative to repo root.

## What it is

Versicle's headline claim is "Privacy-Centric: We don't know what you read. No analytics" (README.md:10) and "Local-First ... Privacy-Centric" (architecture.md:5). This report audits that claim end-to-end: every network primitive in the codebase, what book/user data leaves the device, under which settings, to which hosts, and what architecture (if any) enforces the boundary.

**Verdict in one paragraph:** The "no analytics" half of the claim holds — there are no telemetry SDKs anywhere (verified: no sentry/posthog/gtag/firebase-analytics imports in src/ or package.json). The "we don't know what you read" half is *conditionally* true and architecturally unenforced: once a user enables the global GenAI toggle plus a feature flag, book text samples and full-resolution screenshots of book tables are silently sent to Google Gemini during TTS playback — including prefetches for chapters the user hasn't reached — with no per-book consent, no in-session indicator, and no disclosure copy. Cloud TTS providers send the full book text sentence-by-sentence (that is their job, but it is nowhere documented). The "local" Piper path depends on huggingface.co and cdnjs.cloudflare.com at runtime and *breaks offline*. There is no shared network gateway: `fetch()` is scattered across 8 source files plus an unbundled XHR helper in `public/piper/piper_worker.js`, plus two SDKs (firebase, @google/generative-ai) and one Capacitor plugin. The CSP's `connect-src` contains a blanket `https:`, which makes it a no-op as an egress allowlist, and the Android build ships with no CSP at all. Worst single finding: the GenAI debug-log pipeline persists full prompts — book text and base64 table images — to plaintext `localStorage` *unconditionally*, regardless of the debug-mode toggle.

## File inventory

### Network call sites (the egress surface)

| File | Role |
|---|---|
| `src/lib/genai/GenAIService.ts` | All Gemini calls via `@google/generative-ai` SDK → generativelanguage.googleapis.com. Singleton, callback-based logging. |
| `src/lib/tts/providers/BaseCloudProvider.ts` | Shared cloud-TTS base: cache-first `getOrFetch`, `fetchAudio` POST helper (fetch at :152). |
| `src/lib/tts/providers/GoogleTTSProvider.ts` | texttospeech.googleapis.com — voices list (:57) and synthesis (:93, raw fetch, bypasses `fetchAudio`). |
| `src/lib/tts/providers/OpenAIProvider.ts` | api.openai.com/v1/audio/speech (:52, via `fetchAudio`). |
| `src/lib/tts/providers/LemonFoxProvider.ts` | api.lemonfox.ai/v1/audio/speech (:75, via `fetchAudio`). |
| `src/lib/tts/providers/PiperProvider.ts` | huggingface.co voices.json each `init()` (:85); HF model URLs (:129-207). |
| `src/lib/tts/providers/piper-utils.ts` | `fetchWithBackoff` (:102) for HF model blobs; `piperGenerate` defaults `onnxruntimeUrl` to cdnjs.cloudflare.com (:281). |
| `public/piper/piper_worker.js` | Unbundled static asset: XHR `getBlob` (:2-28), `importScripts` of remote onnxruntime (:115-118), ort wasm fetched from cdnjs (`ort.env.wasm.wasmPaths`, :118). |
| `src/lib/drive/DriveService.ts` | www.googleapis.com/drive/v3 — `fetchWithAuth` wrapper (:20-43), list/download. |
| `src/lib/sync/FirestoreSyncManager.ts` + `firebase-config.ts` | Firestore/Auth via firebase SDK → firestore.googleapis.com, identitytoolkit.googleapis.com (user-configured project). |
| `src/lib/google/WebGoogleAuthStrategy.ts`, `AndroidGoogleAuthStrategy.ts` | OAuth via `@capgo/capacitor-social-login` → accounts.google.com (popup/native; token revoke fetch in plugin). |
| `src/lib/ingestion.ts` (:94, :272, :496) | `fetch(coverUrl)` — **blob: URLs from epub.js**, not remote. Local. |
| `src/components/library/EmptyLibrary.tsx` (:32) | `fetch('/books/alice.epub')` — same-origin sample. Local. |
| `src/hooks/useChineseDictionary.ts` (:19) | `fetch('/dict/cedict.json')` — same-origin. Local. |

### Policy / boundary artifacts

| File | Role |
|---|---|
| `nginx.conf` (:12, :28, :41) | CSP duplicated 3×; `connect-src 'self' https: blob: ...` (wildcard). Web deploy only. |
| `vite.config.ts` (:35) | Fourth copy of the same CSP for `vite preview`. |
| `index.html` | No meta CSP → **Capacitor Android WebView runs with no CSP**. |
| `capacitor.config.ts` | `androidScheme: 'https'`, `cleartext: false`, `allowNavigation: []` — good. |
| `src/sw.ts` | Precache + cover endpoint only; no runtime caching of cross-origin assets, no offline policy. |
| `src/lib/sanitizer.ts` | DOMPurify config for EPUB HTML; strips scripts/external CSS links, **not** remote `<img>`/`url()`. |
| `src/hooks/useEpubReader.ts` (:24-36) | Force-adds `allow-scripts allow-same-origin` to the reader iframe sandbox via MutationObserver. |

### Trigger/consent logic

| File | Role |
|---|---|
| `src/lib/tts/AudioContentPipeline.ts` | Auto-fires background Gemini analyses during TTS prep (:202-248, :296-354); `canUseGenAI` gate (:473). |
| `src/lib/tts/TableAdaptationProcessor.ts` | Sends table-image blobs to Gemini (:77-109); duplicate `canUseGenAI` gate. |
| `src/lib/tts/AudioPlayerService.ts` (:429, :1073, :1183-1184) | Calls the pipeline triggers on section load / auto-advance. |
| `src/store/useGenAIStore.ts` | Flags (`isEnabled`, `isContentAnalysisEnabled`, `isTableAdaptationEnabled`), apiKey, **persisted logs**. |
| `src/store/useTTSStore.ts` | Provider selection + plaintext `apiKeys` in localStorage (:494); dead `enableCostWarning` (:76, :499). |
| `src/hooks/useSmartTOC.ts` | User-initiated: first 500 chars of every section → Gemini (:131-140 collectSectionData). |
| `src/components/SmartLinkDialog.tsx` (:76) | User-initiated: library titles/authors/filenames → Gemini. |
| `src/lib/tts/CostEstimator.ts` | Tracks cloud-TTS character usage — **no consumer reads it**. |
| `src/lib/tts/engine/EngineContext.ts` (:201) / `createWorkerEngineClient.ts` (:175-180) | `GenAIPort` seam; worker delegates GenAI to main thread. Good design. |

## How it works (data & control flow)

### The complete egress matrix

| # | Destination | Data sent | Trigger / gate | Consent granularity |
|---|---|---|---|---|
| 1 | generativelanguage.googleapis.com (Gemini) | Book text samples per group (first 60% truncated to 8 words, tail 40% to 120 chars — GenAIService.ts:282-291), book title, section title | **Automatic** during TTS playback and next-chapter prefetch when `isEnabled && isContentAnalysisEnabled && skipTypes.length>0` (AudioContentPipeline.ts:209-224, :296-332; gate :473) | Global toggle only; no per-book consent; fires for unplayed chapters |
| 2 | generativelanguage.googleapis.com | **Full-resolution screenshots of book tables** (base64 inline) + book/section titles (GenAIService.ts:363-374) | **Automatic** when `isEnabled && isTableAdaptationEnabled` (AudioContentPipeline.ts:226-247; TableAdaptationProcessor.ts:77) | Global toggle only |
| 3 | generativelanguage.googleapis.com | First 500 chars of *every section* of a book + title/language (useSmartTOC.ts:134) | User clicks "Enhance TOC" | Per-action |
| 4 | generativelanguage.googleapis.com | Library inventory: titles, authors, filenames (GenAIService.ts:404-415) | User-initiated reading-list mapping (SmartLinkDialog.tsx:76) | Per-action |
| 5 | texttospeech.googleapis.com | **Full book text**, sentence-by-sentence + API key header (GoogleTTSProvider.ts:76-100); voices list on init (:57) | Provider selected + playback | Provider selection only |
| 6 | api.openai.com | Full book text + Bearer key (OpenAIProvider.ts:47-62) | Provider selected + playback | Provider selection only |
| 7 | api.lemonfox.ai | Full book text + Bearer key (LemonFoxProvider.ts:70-86) | Provider selected + playback | Provider selection only |
| 8 | huggingface.co | No book data; IP + usage pattern. voices.json fetched on **every session** where Piper is active (PiperProvider.ts:85); model files on download | Piper provider selected | None (silent) |
| 9 | cdnjs.cloudflare.com | No book data; **remote code** (ort.min.js + wasm) executed in worker via `importScripts` (piper_worker.js:115-118, piper-utils.ts:281) | Any Piper synthesis | None (silent) |
| 10 | www.googleapis.com/drive/v3 | Folder/file listings (names, sizes, checksums of the user's Drive), file downloads; OAuth token (DriveService.ts) | User connects Drive + browses/imports | OAuth consent |
| 11 | accounts.google.com | OAuth flows; token revoke on logout (@capgo plugin) | User connects Google | OAuth consent |
| 12 | firestore.googleapis.com etc. (user's own Firebase project) | The whole Yjs doc: library inventory (titles/authors), reading progress, **annotations incl. selected book text + notes** (types/db.ts:541-558), vocabulary, reading lists, content-analysis results incl. Gemini-generated table narrations (useContentAnalysisStore.ts is yjs-bound), device registry. Plus checkpoints (full doc snapshots, FirestoreSyncManager.ts:196, :649) | Sync enabled + Firebase config entered | Explicit setup; **no E2E encryption** (grep "encrypt" in src/lib/sync → zero hits) |
| 13 | Browser/OS vendor (WebSpeech "local" provider) | Potentially full book text: `WebSpeechProvider` (id `'local'`) exposes all system voices with no `localService` filtering (WebSpeechProvider.ts:39-90) — Chrome's "Google …" voices are network voices | Default web provider | None; labeled "local" |
| 14 | Device TTS engine vendor (CapacitorTTSProvider) | Same caveat on Android: the default engine (usually Google TTS) may synthesize in the cloud depending on engine settings | Default Android provider | OS-level |
| 15 | Arbitrary hosts via EPUB content | A malicious/tracking EPUB can embed `<img src="https://tracker/...">` or `<style>` `url()`; sanitizer does not strip remote images (sanitizer.ts:40-58), reader iframe is same-origin with scripts force-enabled (useEpubReader.ts:24-36), and CSP `img-src ... https:` (nginx.conf:12) allows it | Opening a chapter | None — this is per-chapter read-tracking |

Same-origin/local-only flows (not egress, listed for completeness): cover `fetch(blobUrl)` in ingestion.ts; `/books/alice.epub`; `/dict/cedict.json`; `/piper/*` wasm assets; SW cover endpoint.

### Control flow of the auto-fire path (the headline issue)

1. User enables "AI features" + "Content analysis" once, globally (GenAISettingsTab).
2. User plays TTS on *any* book. `AudioPlayerService` loads a section → `AudioContentPipeline.loadSection` → `triggerAnalysis` (AudioPlayerService.ts:429, AudioContentPipeline.ts:168).
3. `triggerAnalysis` fire-and-forgets `detectContentSkipMask` (book text groups → Gemini) and `processTableAdaptations` (table screenshots → Gemini) when the flags are on (AudioContentPipeline.ts:213-247).
4. On section transition, `triggerNextChapterAnalysis` (AudioPlayerService.ts:1184) prefetches Gemini analysis for the *next* chapter — content the user has not read or listened to (AudioContentPipeline.ts:296-354).
5. Gate: `canUseGenAI = aiStore.isEnabled && (isConfigured() || !!aiStore.apiKey || !!localStorage.getItem('mockGenAIResponse'))` (AudioContentPipeline.ts:473; duplicated at TableAdaptationProcessor.ts:77). No per-book bit, no network/offline check, no UI indicator while it runs.
6. Every request and response is logged with full payload via `GenAIService.log` (GenAIService.ts:138, :195) → `useGenAIStore.addLog` → **persisted to localStorage** (`partialize: (state) => ({...state})`, useGenAIStore.ts:105-107), capped at 500 entries but *not* gated by `isDebugModeEnabled` (that flag only gates UI overlays — ContentAnalysisLegend.tsx:281, ReaderView.tsx:758; the log callback is installed unconditionally in `init()`, useGenAIStore.ts:97).

### Network boundary enforcement today

There is none. Eleven `fetch()` call sites across 8 files, one XHR helper in an unbundled public asset, two SDKs, and one auth plugin. CSP `connect-src 'self' https: blob: https://*.googleapis.com https://*.firebaseio.com` — the bare `https:` scheme source makes the host entries decorative; any https host is allowed. The CSP string is copy-pasted four times (nginx.conf:12, :28, :41; vite.config.ts:35). The Capacitor Android app gets no CSP (index.html has no meta tag; nginx headers don't apply). The only genuinely enforced boundary is Capacitor's `allowNavigation: []` (navigation, not fetch).

## Technical debt

### D1. No network gateway / egress policy — fetch scattered, boundary unenforceable
- **Severity:** critical | **Category:** architecture
- **Evidence:** fetch in 8 files (`src/lib/ingestion.ts:94,272,496`; `src/lib/tts/providers/PiperProvider.ts:85`; `piper-utils.ts:102`; `GoogleTTSProvider.ts:57,93`; `BaseCloudProvider.ts:152`; `src/lib/drive/DriveService.ts:24`; `src/hooks/useChineseDictionary.ts:19`; `src/components/library/EmptyLibrary.tsx:32`) plus XHR in `public/piper/piper_worker.js:9` (outside TS/lint), plus the firebase and @google/generative-ai SDKs, plus @capgo/capacitor-social-login. No module owns "what hosts may we talk to"; CSP `connect-src` contains blanket `https:` (nginx.conf:12) so it enforces nothing.
- **Impact:** The README privacy claim is unverifiable and will silently rot — any agent-written patch can add a new endpoint and no test, lint, or header catches it. Planned refactors (offline caching, timeout policy, GenAIClient/SyncBackend seams) will each re-invent ad-hoc fetch wrappers. CSP can never be tightened because there is no canonical destination list to tighten it to.
- **Fix:** Create `src/lib/net/` with (a) a typed destination registry (host, purpose, data classification: `book-content` / `book-derived` / `metadata` / `binary-asset` / `auth`, consent requirement, timeout, retry, offline behavior); (b) a `NetworkGateway.egress(destination, init)` wrapper all call sites route through; (c) an ESLint `no-restricted-globals`/`no-restricted-syntax` rule banning raw `fetch`/`XMLHttpRequest` outside `src/lib/net/`; (d) a build step that derives CSP `connect-src` for nginx/vite/index.html-meta from the registry; (e) a unit test asserting registry hosts == CSP hosts.

### D2. Background Gemini analyses auto-fire book content without per-book consent or visibility
- **Severity:** high | **Category:** security
- **Evidence:** `AudioContentPipeline.ts:209-247` (fire-and-forget on every section load), `:296-354` (prefetch for the *next*, unplayed chapter), gate at `:473`; `TableAdaptationProcessor.ts:77` sends full table screenshots; `AudioPlayerService.ts:1183-1184` invokes both on auto-advance. No UI indicator during transmission; no per-book opt-in; `GenAISettingsTab.tsx` contains zero disclosure copy (grep for "sent"/"third party"/"privacy" → no hits).
- **Impact:** Directly contradicts README.md:10 for any user who flipped the global toggle for one book: *every* book they subsequently play leaks text samples and table images to Google. Reputational/correctness risk for the product's core promise; impossible to audit after the fact because the only record is the (itself problematic) local log.
- **Fix:** Per-book AI consent bit stored in the synced preferences (default off; prompt on first TTS play of each book when global AI is on). Route the calls through the NetworkGateway consent gate. Add a transient "AI analysis active" indicator in the TTS UI. Keep the existing `referenceDetectionStrategy: 'deterministic'` zero-egress path (AudioContentPipeline.ts:466-471) as the default.

### D3. GenAI logs persist full book text and base64 table images to localStorage, unconditionally
- **Severity:** high | **Category:** security (also correctness)
- **Evidence:** `GenAIService.ts:138` logs `{ prompt }` and `:195` logs `{ prompt, schema, ... }` where for table adaptation the prompt object embeds `inlineData.data` base64 images (`:363-374`); callback installed unconditionally at `useGenAIStore.ts:97`; `partialize: (state) => ({ ...state })` persists `logs` (and `apiKey`) to `localStorage['genai-storage']` (useGenAIStore.ts:102-110); `maxLogs` default 500. `isDebugModeEnabled` gates only reader overlays (ContentAnalysisLegend.tsx:281), not capture or persistence.
- **Impact:** (1) Privacy: book text and page imagery at rest in plaintext localStorage — exfiltratable by any XSS, extension, or shared-device access; survives "delete book". (2) Correctness: 500 entries containing base64 images will exceed the ~5MB localStorage quota; `setItem` throws and zustand persist starts failing silently, breaking persistence of *all* GenAI settings.
- **Fix:** Redact by default: log method, correlationId, byte/char counts, and content hashes; keep full payloads only in a bounded in-memory ring buffer when `isDebugModeEnabled`, never persisted. Explicit `partialize` allowlist (settings only). One-time migration: strip `logs` from `genai-storage` on rehydrate (persist `version` bump).

### D4. CSP is decorative: wildcard connect-src, 4 duplicated copies, none on Android
- **Severity:** high | **Category:** security
- **Evidence:** `connect-src 'self' https: blob: https://*.googleapis.com https://*.firebaseio.com` — the bare `https:` allows every https host (nginx.conf:12, repeated :28, :41; vite.config.ts:35). `img-src 'self' data: blob: https:` allows arbitrary remote images. `index.html` has no meta CSP, and the Capacitor Android WebView serves assets without nginx, so the Android app has **no CSP at all**. `script-src` includes `'unsafe-inline' 'unsafe-eval' blob:`.
- **Impact:** The one platform mechanism that could enforce the egress map enforces nothing; the four hand-maintained copies guarantee drift; the strongest deployment (Android) is the least protected.
- **Fix:** Generate CSP from the D1 destination registry: enumerate exact hosts (`generativelanguage.googleapis.com`, `texttospeech.googleapis.com`, `api.openai.com`, `api.lemonfox.ai`, `huggingface.co`, `cdn-*.huggingface.co` (redirect targets), `www.googleapis.com`, `accounts.google.com`, `firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`, user's authDomain) and drop `https:` from connect-src and img-src. Emit once into nginx.conf (template), vite preview config, and an index.html meta tag so Capacitor gets it too. Self-hosting onnxruntime (D6) removes cdnjs from the list.

### D5. EPUB content can phone home (read-tracking pixels)
- **Severity:** high | **Category:** security
- **Evidence:** `sanitizeContent` strips `<script>`, external `<link>` CSS, and event handlers but leaves `<img src="https://...">` and inline `<style>` `url(https://...)` intact (sanitizer.ts:40-58); the reader iframe is forced to `allow-scripts allow-same-origin` (useEpubReader.ts:24-36) so it inherits the page CSP, whose `img-src ... https:` permits any host (nginx.conf:12). A book embedding a unique pixel per chapter learns exactly when each chapter is opened, plus the reader's IP. Bonus: `FORBID_ATTR: ['on*', 'javascript:', 'data:']` (sanitizer.ts:52) are no-ops — DOMPurify forbids attributes by literal name, not glob; these entries match nothing (harmless only because DOMPurify's defaults already drop event handlers).
- **Impact:** "We don't know what you read" is defeated by the book itself for third parties. This is the classic e-reader privacy leak (cf. Calibre/Kobo trackers) and is fully silent.
- **Fix:** In the sanitize hook, rewrite remote image/css URLs to a blocked placeholder (optionally behind a per-book "allow remote content" toggle, as mail clients do); tighten `img-src` to `'self' data: blob:`; remove the dead FORBID_ATTR entries; add a regression test with a tracking-pixel EPUB fixture.

### D6. "Offline" Piper TTS depends on two third-party CDNs at runtime — and breaks offline
- **Severity:** high | **Category:** correctness (also security/supply-chain)
- **Evidence:** `PiperProvider.init()` fetches `https://huggingface.co/.../voices.json` on every session with no cache fallback (PiperProvider.ts:85); on failure `voiceMap` stays empty, so `fetchAudioData` throws `Voice ${id} not found` (:201-204) even when the model blobs are fully downloaded in CacheStorage — offline playback with a downloaded voice fails and the manager silently falls back to WebSpeech (TTSProviderManager.ts:88-92). Synthesis additionally pulls `ort.min.js` + wasm from `https://cdnjs.cloudflare.com/...` (piper-utils.ts:281 default; piper_worker.js:115-118) — remote code executed via `importScripts` inside the worker, cached only in an in-memory `blobs` map keyed per page load (piper_worker.js:2-28), so it re-downloads each session.
- **Impact:** The README's "free, unlimited offline listening" is false on an airplane; cdnjs is a supply-chain injection point for code that processes book text; HF/cdnjs learn usage patterns and IP on every listening session.
- **Fix:** Cache `voices.json` (Cache API, stale-while-revalidate) and build `voiceMap` from cache when offline; better, persist voice metadata at download time so playback never needs the catalog. Vendor onnxruntime-web into `/public/piper/` (it's already an npm-resolvable asset) and delete the cdnjs default. Route HF downloads through the NetworkGateway with progress + abort.

### D7. Provider locality is unmodeled — "local" providers can be network-backed
- **Severity:** medium | **Category:** type-safety / architecture
- **Evidence:** `WebSpeechProvider` has `id = 'local'` but maps all `speechSynthesis` voices without checking `voice.localService` (WebSpeechProvider.ts:39-43, :70-90) — Chrome's "Google US English" etc. are network voices that stream text to Google. `PiperProvider extends BaseCloudProvider` (PiperProvider.ts:69) — a local engine classified as cloud, which is why it inherits `CostEstimator.track` for free local synthesis (BaseCloudProvider.ts:95). `TTSVoice` (providers/types.ts) carries no locality field. `CapacitorTTSProvider` inherits whatever the OS engine does.
- **Impact:** Users choosing "local" for privacy may still be sending text to a vendor; the type system can't express the one distinction the product's marketing depends on; cost tracking fires for free synthesis.
- **Fix:** Add `locality: 'on-device' | 'network' | 'os-dependent'` to `TTSVoice`/`ITTSProvider`; filter or badge network voices in the voice picker; split `BaseCloudProvider` into transport-agnostic caching base + cloud-HTTP subclass; surface locality in the settings UI from the same registry.

### D8. Dead egress/cost guardrails: CostEstimator has no reader, enableCostWarning has no consumer
- **Severity:** medium | **Category:** dead-code
- **Evidence:** `CostEstimator.getInstance().track(text)` fires before every cloud fetch (BaseCloudProvider.ts:95) and writes `useCostStore`, but a repo-wide grep finds no component reading `useCostStore`/`getSessionUsage`. `enableCostWarning` is defined, defaulted true, settable, and persisted (useTTSStore.ts:76, :161, :354, :499) but never read anywhere.
- **Impact:** The code *looks* like it has a spend/egress speed bump; it has none. Users can burn paid API quota (and stream an entire book to a vendor) with zero feedback. Misleads future maintainers into thinking the guardrail exists.
- **Fix:** Either wire it: session character/cost readout in TTS settings + a threshold warning gated by `enableCostWarning` before large cloud sessions; or delete both. Wiring is trivial since tracking already works and belongs in the NetworkGateway metrics anyway.

### D9. Test backdoors in production gating logic
- **Severity:** medium | **Category:** security / hygiene
- **Evidence:** `localStorage.getItem('mockGenAIResponse')`/`'mockGenAIError'` short-circuit `isConfigured()` and `generateStructured()` in production builds (GenAIService.ts:82, :168-190) and are OR-ed into the egress gates (`AudioContentPipeline.ts:473`, `TableAdaptationProcessor.ts:77`). `window.__VERSICLE_SANITIZATION_DISABLED__` disables EPUB sanitization (useEpubReader.ts:316-321).
- **Impact:** A single localStorage write (any XSS, extension, or console paste) flips AI-configured state or disables the sanitizer; the consent/gating expression is polluted with test concerns in three places, so refactoring it safely requires knowing the E2E suite.
- **Fix:** Move mocks behind a build-time flag (`import.meta.env.MODE === 'test'` / dedicated test build) or inject a `GenAIClient` fake via the existing `GenAIPort` seam; delete the localStorage checks from production gates.

### D10. No timeout/abort on any cloud fetch; dead `signal` parameter
- **Severity:** medium | **Category:** hygiene / performance
- **Evidence:** `BaseCloudProvider.fetchAudio(url, body, headers, signal?)` accepts a signal (BaseCloudProvider.ts:151-160) but no caller passes one (OpenAIProvider.ts:54, LemonFoxProvider.ts:83); `GoogleTTSProvider.fetchAudioData` bypasses `fetchAudio` entirely with a raw fetch (:93). `GenAIService` and `DriveService` have no abort/timeout. No `AbortController` exists outside tests; no `navigator.onLine` checks in any egress module.
- **Impact:** A hung TTS or Gemini request stalls the playback queue indefinitely (the engine's enqueue serialization makes this head-of-line blocking, cf. architecture.md:544); Drive scans can't be cancelled.
- **Fix:** Make timeout + AbortSignal part of the NetworkGateway request contract (per-destination defaults: TTS 30s, GenAI 60s, Drive download none-but-abortable); thread cancellation from `AudioPlayerService.stop()`.

### D11. Plaintext credentials in localStorage enable silent egress
- **Severity:** medium | **Category:** security
- **Evidence:** Gemini `apiKey` persisted via the spread partialize (useGenAIStore.ts:105-107); TTS `apiKeys` for google/openai/lemonfox (useTTSStore.ts:494); Firebase config incl. apiKey (useSyncStore.ts:107). All plaintext in localStorage.
- **Impact:** Same XSS/extension/shared-device exposure as D3, but these are *credentials*: exfiltration enables impersonated egress and spend on the user's accounts. (Other subsystem reports flag the storage; the egress angle is that the keys are the capability tokens for every destination in this map.)
- **Fix:** Dedicated `secrets` storage module; on Android use Capacitor SecureStorage/Keystore; on web at minimum isolate from synced/spread state, never include in exports/logs, and document the residual risk.

### D12. Sync egress carries book excerpts with no E2E encryption and no documentation
- **Severity:** medium | **Category:** architecture
- **Evidence:** Annotations sync with `text` (the selected passage) and `note` (types/db.ts:541-558) inside the Yjs doc; content-analysis results including Gemini's table narrations are yjs-bound (useContentAnalysisStore.ts:112); checkpoints store full doc snapshots in Firestore (FirestoreSyncManager.ts:196-364, :649). No encryption layer exists in `src/lib/sync` (grep "encrypt" → 0). The Firestore project is user-owned (BYO config), which mitigates but is nowhere explained.
- **Impact:** "What you read" — highlighted passages, vocabulary, exact reading positions — is readable by anyone with access to the Firebase project (and by Google). Users have no way to know this trade-off exists; the README's "Dual Sync" bullet doesn't mention it.
- **Fix:** Document the matrix (D13); offer optional passphrase-based E2EE of Yjs updates/checkpoints (the update-blob pipeline is already opaque bytes to Firestore, making this tractable); minimum bar: a settings-page disclosure of exactly what syncs.

### D13. No privacy/data-flow documentation; settings UI has no disclosure
- **Severity:** medium | **Category:** hygiene / docs
- **Evidence:** architecture.md mentions privacy only as a goal (:5, :17) — no egress section; README.md:10 makes the absolute claim; `GenAISettingsTab.tsx` and the TTS provider picker contain no copy about data leaving the device (grep for consent/disclosure terms → 0 hits).
- **Impact:** The claim and reality can drift indefinitely (they already have); every future feature decision about network use is made without a stated policy to check against.
- **Fix:** Add a "Privacy & data flow" section to architecture.md containing the matrix from this report, generated or hand-synced from the D1 registry; render the same registry as a read-only "Network activity" panel in settings; add disclosure sentences next to each egress-enabling toggle.

### D14. GenAI plumbing duplication: gate logic and stale fallback model id in two places
- **Severity:** low | **Category:** duplication
- **Evidence:** The `canUseGenAI` expression and the `configure(apiKey, 'gemini-1.5-flash')` fallback are copy-pasted in AudioContentPipeline.ts:473+:505-507 and TableAdaptationProcessor.ts:77-83; the hardcoded fallback `'gemini-1.5-flash'` disagrees with the store default `'gemini-flash-lite-latest'` (useGenAIStore.ts:45) and with `GenAIService.modelId` default (GenAIService.ts:36). The SDK itself (`@google/generative-ai`) is the deprecated package (superseded by `@google/genai`).
- **Impact:** Gate changes (e.g., adding per-book consent) must be made twice or they silently diverge; a 404'd legacy model id can break analysis only on the fallback path, which is the hardest to reproduce.
- **Fix:** Single `ensureGenAIReady()` in the GenAI module (behind `GenAIPort`); one source of truth for the default model; migrate to the maintained SDK during the GenAIClient-seam work.

## Problematic couplings

- **TTS pipeline → GenAI config duplication:** `AudioContentPipeline` and `TableAdaptationProcessor` each re-implement configuration/consent logic and call `this.ctx.genAI.configure(...)` with their own hardcoded model (AudioContentPipeline.ts:506, TableAdaptationProcessor.ts:82) instead of the GenAI module owning readiness.
- **lib → store back-references at egress points:** `providerFactory.ts:22` reads `useTTSStore.getState()` for API keys; `firebase-config.ts:34` reads `useSyncStore`; `GoogleIntegrationManager` reads `useGoogleServicesStore`/`useSyncStore` (GoogleIntegrationManager.ts:21-37). Credentials flow store→lib in three different ad-hoc shapes; a gateway should receive them via one injection seam.
- **Egress in an unbundled static asset:** `public/piper/piper_worker.js` performs XHR and remote `importScripts` outside TypeScript, ESLint, and any future gateway — boundary enforcement cannot see it until it is moved into `src/` and bundled (vite worker bundling is already configured, vite.config.ts:24-29).
- **Service worker vs egress policy:** `src/sw.ts` knows only covers + precache; offline behavior for HF/cdnjs/dict assets is implemented (or not) ad hoc in each caller. Runtime-caching policy belongs with the destination registry.
- **GenAIService ↔ useGenAIStore log loop:** service pushes logs into the store via callback (useGenAIStore.ts:97), store persists them; the privacy property of the log pipeline is split across two files with opposite assumptions (service: "logging is diagnostics"; store: "persist everything").
- **CSP ownership split across repos/files:** nginx.conf (3 copies), vite.config.ts, and — by omission — index.html/Capacitor. No code owns the host list.

## What's good (keep)

- **`EngineContext.genAI` (GenAIPort) seam** (EngineContext.ts:201; createZustandEngineContext.ts; createWorkerEngineClient.ts:175-180): the TTS engine never imports the GenAI service statically; the worker delegates all GenAI (and all cloud TTS, via the main-thread `TTSProviderManager`) to the host. This is exactly the injection point a NetworkGateway needs — egress is already main-thread-only and port-mediated inside the engine.
- **`DriveService.fetchWithAuth`** (DriveService.ts:20-43): one authenticated wrapper with 401-refresh-retry for every Drive call — a miniature gateway worth generalizing rather than replacing.
- **`BaseCloudProvider.getOrFetch`** (BaseCloudProvider.ts:74-116): cache-first, in-flight dedup, permanent TTS audio cache — minimizes repeat egress of the same text by design.
- **Prompt minimization in `detectContentTypes`** (GenAIService.ts:282-291): deliberate 8-word/120-char truncation is real data minimization; the deterministic zero-egress strategy option (AudioContentPipeline.ts:466-471) is the right kind of escape hatch.
- **Capacitor hardening** (capacitor.config.ts): `androidScheme: 'https'`, `cleartext: false`, `allowNavigation: []`.
- **No analytics, no third-party scripts in index.html, self-hosted fonts, BYO keys/BYO Firebase** — the no-first-party-server model is genuine and verified.
- **Sanitizer fundamentals** (sanitizer.ts): script stripping, external-CSS-link removal, reverse-tabnabbing fix — extend, don't rewrite.
- **Firestore offline persistence + user-owned project model** (firebase-config.ts:118-127).

## Target design

1. **`src/lib/net/destinations.ts` — the egress registry (single source of truth).** A typed const array: `{ id, hosts, purpose, dataClass: 'book-content'|'book-derived'|'metadata'|'binary-asset'|'auth'|'remote-code', consent: 'none'|'global-flag'|'per-book'|'per-action'|'oauth', timeoutMs, retry, offline: 'fail'|'cache-fallback'|'queue' }`. Entries: gemini, google-tts, openai-tts, lemonfox-tts, hf-piper-catalog, hf-piper-models, drive, google-oauth, firebase (hosts from user config), plus `same-origin`.
2. **`src/lib/net/NetworkGateway.ts`.** `egress(destinationId, request): Promise<Response>` applying the policy: consent check (throws `ConsentRequiredError` consumed by UI), AbortController with per-destination timeout, offline behavior, and counters (bytes/chars out per destination per session — replacing dead CostEstimator). All 11 fetch sites route through it; `piper_worker.js` moves into `src/workers/` so its loader requests are gateway-mediated on the main thread (blobs posted to the worker, which it already supports).
3. **Lint + test enforcement.** ESLint bans `fetch`/`XMLHttpRequest`/`navigator.sendBeacon` outside `src/lib/net/`; a unit test asserts CSP `connect-src` == registry hosts; CSP generated into nginx template, vite preview headers, and an index.html `<meta>` (covering Capacitor).
4. **Consent model.** Per-book `aiConsent` in the synced preferences map; gateway consults it for `dataClass: 'book-content'|'book-derived'` destinations triggered non-interactively. Cloud TTS provider selection counts as consent for TTS text but gets a one-time disclosure dialog (reusing the dead `enableCostWarning`).
5. **Local-by-default Piper.** onnxruntime vendored into `/public/piper/`; voices.json cached stale-while-revalidate with offline fallback; voice metadata persisted at download time so playback never needs the catalog.
6. **Redacted logging.** `GenAILogEntry.payload` becomes `{ summary, charCount, imageCount, hash }`; full payloads only in-memory under debug mode; persist allowlist excludes logs and apiKey.
7. **Reader content firewall.** Sanitizer rewrites remote `img/src`/`url()` to placeholders (per-book override switch); `img-src` drops `https:`.
8. **Docs/UI from the registry.** architecture.md gains a generated "Privacy & data flow" matrix; settings gains a "Network activity" panel showing destinations, last-used timestamps, and session byte counts — making the README claim continuously auditable.

## Migration notes

- **Phase 1 (no behavior change):** Introduce registry + gateway; mechanically route the 11 fetch sites and `GenAIService`'s SDK construction (the SDK accepts no fetch injection — either wrap at callsite level and keep SDK host in the registry, or migrate to `@google/genai` which supports custom fetch) through it. Add lint rule with temporary file-level disables, burn them down. Zero user impact.
- **Phase 2 (log redaction + secrets):** Bump `genai-storage` persist version; migration strips `logs` and moves `apiKey` (and useTTSStore `apiKeys`, useSyncStore `firebaseConfig.apiKey`) into a `versicle-secrets` storage module. Users keep their keys; existing oversized localStorage entries get cleaned, fixing latent quota failures. Reversible; no server data involved.
- **Phase 3 (consent + UX):** Ship per-book consent defaulting to *granted* for books the user has already played with AI flags on (derive from existing `contentAnalysis` records in the Yjs doc so current users see no new prompts), *ask* for new books. Wire disclosure copy and the network-activity panel.
- **Phase 4 (Piper offline + CSP tightening):** Vendor onnxruntime (bundle-size note: ~1.5MB wasm, already effectively shipped via cdnjs); add voices.json caching; then remove `https:` from connect-src/img-src and enable the strict generated CSP across nginx/preview/meta. Do CSP last — it is the enforcement step and must follow, not precede, the host enumeration, or Piper/Drive/Firebase will break for users mid-rollout.
- **Data migrations:** only the localStorage ones above (persist-version bumps with `migrate` functions — the codebase already uses this pattern in useTTSStore). The Yjs doc and Firestore schemas are untouched; optional E2EE for sync (D12) is a separate, larger project and should be designed with the SyncBackend seam work, not bolted on here.
- **Regression safety:** the egress matrix in this report doubles as the acceptance checklist — after each phase, run the app with devtools network panel + a tracking-pixel EPUB fixture and verify: no requests beyond the registry, no Gemini traffic without consent, Piper playback in airplane mode with a downloaded voice.
