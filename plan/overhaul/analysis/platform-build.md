# Platform, PWA, build & dependencies — subsystem analysis

Analyzed: 2026-06-10. Repo root: `/Users/btsai/claude/versicle/.claude/worktrees/amazing-davinci-d7336e` (worktree of Versicle; default branch `antigravity`). All paths below are repo-relative.

## What it is

The "everything that isn't app code" layer: the Vite build (web + workers + PWA), the custom service worker, the test runner configs (Vitest, Playwright), lint/TS configs, the Capacitor Android shell, Docker images for prod serving / Android tests / E2E verification, GitHub Actions CI, npm dependency management (including three forked git dependencies and two install-time patching mechanisms), and the static asset tree under `public/`.

## File inventory

| File | Role |
|---|---|
| `vite.config.ts` | Build + dev server + PWA plugin + **a dead vitest `test` block** + auth proxy + ANALYZE-gated bundle visualizer |
| `vitest.config.ts` | The vitest config that actually wins (jsdom, globals, 60s timeout, excludes `verification/**` only) |
| `playwright.config.ts` | E2E config: desktop/mobile/webkit projects, per-project timeouts/retries with good rationale comments |
| `tsconfig.json` | Solution file referencing app + node configs |
| `tsconfig.app.json` | App typecheck (strict, ES2022, bundler resolution); **excludes all tests** |
| `tsconfig.node.json` | Typechecks **only `vite.config.ts`** — other root configs never typechecked |
| `eslint.config.js` | Flat config; ignores `dist, coverage, venv, android, .claude` |
| `src/sw.ts` | injectManifest service worker: precache + `skipWaiting`/`clientsClaim` + `/__versicle__/covers/` fetch handler |
| `src/sw-utils.ts` | SW-side IndexedDB cover lookup (duplicates DB schema knowledge: `EpubLibraryDB`, `static_manifests`, legacy `books`) |
| `src/lib/serviceWorkerUtils.ts` | `waitForServiceWorkerController()` — boot gate; 3s ready-race + exponential controller polling; never rejects |
| `src/App_SW_Wait.test.tsx`, `src/sw-utils.test.ts` | SW unit tests (heavy mocking; one test mocks `global.Response` with a long apology comment) |
| `index.html` | Minimal shell; icons point at `/pwa-*.png`; no description/theme-color meta |
| `public/` | `manifest.webmanifest` (stale, broken), `alice.epub` (+ duplicate in `public/books/`), `dict/cedict.json` (14 MB), `fonts/` (864 KB), PWA icons, `favico.ico` (sic), `README.md` (drifted) |
| `icons/` (repo root) | 7 webp icons referenced only by the stale public manifest; **not in `public/`, never served** |
| `capacitor.config.ts` | Android shell config: `androidScheme: 'https'`, `allowNavigation: []`, MediaSession foregroundService "always" |
| `android/` | Capacitor Android project: AGP 8.13.2, Gradle 8.13 wrapper, `MainActivity.java` (SocialLogin glue), Robolectric unit tests, committed `google-services.json` |
| `patches/@capgo+capacitor-social-login+7.20.0.patch` | patch-package: adds `login_hint` passthrough to Google OAuth (ESM dist only; CJS + .d.ts untouched) |
| `scripts/patch_piper_worker.js` | 6 string-replacement patches applied to `public/piper/piper_worker.js` at postinstall |
| `scripts/compile-dict.cjs` | Downloads CC-CEDICT → `public/dict/cedict.json`; on failure silently writes a mock dictionary |
| `scripts/install_android_sdk.sh` | Installs SDK 34 (drifted vs Dockerfile's 35 vs build.gradle's 36) |
| `scripts/README.md` | Documents only `generate_pwa_icons.py`, which does not exist |
| `package.json` | Deps incl. 3 git forks, husky-in-deps, `prepare-piper` postinstall hack |
| `Dockerfile` | node:20-alpine build → nginx:alpine with envsubst template (good pattern) |
| `Dockerfile.android` | temurin-21 + Node 22 + SDK 35 → `gradlew test`; **broken by `.dockerignore`** |
| `Dockerfile.verification` | playwright:v1.60.0-jammy; `npm ci --legacy-peer-deps`; preview-server entrypoint |
| `nginx.conf` | SPA fallback, 1y asset caching, CSP repeated 3×, `/__/auth/` Firebase proxy via envsubst |
| `.dockerignore` | Single shared ignore file; **excludes `android`** (and `*.md`, `*.txt`, `public/piper`) |
| `.github/workflows/*` | npm-test, deploy (GH Pages), docker-publish, android, visual-verification — **all push-trigger on `main`, not `antigravity`** |
| `run_verification.sh`, `run_android_tests.sh`, `jules_run_verification.sh`, `verification/docker_entrypoint.sh` | Docker wrappers for E2E/Android suites (help text drifted to a defunct pytest flow) |
| Root strays | `test-backup.ts`, `test-yjs.js`, `test-missing-notes.test.ts`, `test_use_local_storage_events.test.tsx`, `use-local-storage-other-tab.test.ts`, `test_files.txt`, `getDeviceId_perf.md`, `verification_script.py` |
| `tailwind.config.js` | **Dead** (Tailwind 4 CSS-first; no `@config` in `src/index.css`) |
| `postcss.config.js` | `@tailwindcss/postcss` + redundant `autoprefixer` |

## How it works (data & control flow)

**Build**: `npm run build` = `tsc -b` (app sources only, tests excluded) + `vite build`. VitePWA (`strategies: 'injectManifest'`, `registerType: 'autoUpdate'`) compiles `src/sw.ts` and injects the precache manifest (default glob `**/*.{js,css,html}`, limit raised to 4 MB at `vite.config.ts:52`). Workers are ES-module format (`vite.config.ts:24-29`) so the TTS worker (`src/workers/tts.worker.ts`, instantiated at `src/lib/tts/engine/createWorkerEngineClient.ts:102`) and search worker get their own code-split graphs. `ANALYZE=true` enables `rollup-plugin-visualizer` for both the main bundle (`stats.html`) and worker bundle (`stats-worker.html`).

**Install pipeline**: `postinstall` runs `patch-package` (the capgo OAuth patch) then `prepare-piper` (`package.json:14-15`): copies 4 piper-wasm artifacts into `public/piper/` and string-patches `piper_worker.js` (6 patches in `scripts/patch_piper_worker.js`). The patched worker is a classic worker loaded at runtime from `/piper/piper_worker.js` (`src/lib/tts/providers/piper-utils.ts:292`) — entirely outside Vite's module graph. `public/piper/` is git- and docker-ignored, regenerated on every install.

**PWA runtime**: vite-plugin-pwa auto-injects `registerSW.js` (no `virtual:pwa-register` usage anywhere). `src/sw.ts` does `skipWaiting()` + `clientsClaim()` + `precacheAndRoute` and adds one fetch handler: same-origin requests to `/__versicle__/covers/<bookId>` are answered by reading the cover blob directly out of IndexedDB (`src/sw-utils.ts`), with a legacy-store fallback. App boot (`src/App.tsx:106-117`) blocks the entire UI on `waitForServiceWorkerController()` so those cover URLs will resolve.

**Test runners**: `npm test` = `vitest run` → uses `vitest.config.ts` (which **overrides** the `test` block inside `vite.config.ts` — see Debt #1). Playwright suite lives in `verification/` (88 files), normally run inside `Dockerfile.verification` via `run_verification.sh` (builds image, `--ipc=host`, mounts screenshots).

**CI**: five workflows; push triggers all reference `main` while the repository's default/integration branch is `antigravity` (`origin/HEAD -> origin/antigravity`). PR-triggered runs (npm-test, visual-verification, android-on-android-paths) still fire because their `pull_request` triggers are unfiltered.

**Android**: Capacitor 7 copies `dist/` into the WebView app. `MainActivity` adds EdgeToEdge + SocialLogin activity-result plumbing. Robolectric unit tests run via `Dockerfile.android`.

## Technical debt

### 1. Vitest config duplication — the `.claude` worktree exclusion was added to the dead copy
- **Severity**: critical · **Category**: correctness
- **Evidence**: `vitest.config.ts` exists (jsdom, 60s timeout, `exclude: [...configDefaults.exclude, 'verification/**']` at line 9) **and** `vite.config.ts:75-83` contains a second `test` block. Vitest documents that a root `vitest.config.ts` takes priority and the `test` field of `vite.config.ts` is ignored. Commit `0fbd8e9c` ("fix(test): exclude .claude/ worktrees from vitest and eslint discovery", 2026-06-09) added `'.claude/**', '**/.claude/**'` excludes **only to `vite.config.ts`** — the dead block.
- **Impact**: The bug the commit claims to fix is still live: a top-level `npm test` in a checkout containing `.claude/worktrees/*` will discover every worktree's test suite. Worse, the two configs have already drifted (`testTimeout: 60000` and `verification/**` exclude only in `vitest.config.ts`; `.claude` excludes only in `vite.config.ts`), and every future contributor has a coin-flip chance of editing the wrong one.
- **Fix**: Delete the `test` block from `vite.config.ts` entirely; make `vitest.config.ts` the single source by `mergeConfig`-ing the vite config (or `defineProject`), and fold in **all** excludes (`verification/**`, `.claude/**`, `**/.claude/**`, root strays once removed). Add a comment in `vite.config.ts` pointing at `vitest.config.ts`.

### 2. `Dockerfile.android` is broken: `.dockerignore` excludes `android/` from its build context
- **Severity**: critical · **Category**: correctness
- **Evidence**: `.dockerignore:10` lists `android` (added in commit `6dd80848`, 2026-03-01 — an unrelated "Yjs data recovery tool" feature commit). `Dockerfile.android:44` `COPY . .`, `:50` `npx cap sync android`, `:53-57` `WORKDIR /app/android && chmod +x gradlew && CMD ./gradlew test` all require `android/` in the context. Docker uses one shared `.dockerignore` for all Dockerfiles (`git ls-files | grep dockerignore` shows only the one file; no `Dockerfile.android.dockerignore`).
- **Impact**: `docker build -f Dockerfile.android .` (and therefore `run_android_tests.sh` and `.github/workflows/android.yml`) cannot have worked since 2026-03-01. The CI job is path-filtered to `android/**` which has barely changed since, so an entire test pipeline (the Robolectric plugin/bridge tests) is silently dead. Textbook AI-agent collateral damage: a hygiene edit in an unrelated commit severed a build.
- **Fix**: Use BuildKit per-Dockerfile ignore files (`Dockerfile.android.dockerignore` without `android`), or remove `android` from the shared ignore and let `Dockerfile`/`Dockerfile.verification` ignore it explicitly. Add a CI job (or at least a weekly scheduled run) that actually builds `Dockerfile.android` regardless of changed paths so breakage is detected.

### 3. CI triggers target `main` but the integration branch is `antigravity`
- **Severity**: high · **Category**: correctness (process)
- **Evidence**: `origin/HEAD -> origin/antigravity`. `npm-test.yml`/`deploy.yml`/`docker-publish.yml`/`visual-verification.yml` all use `on.push.branches: ["main"]`; `android.yml` uses `["main", "capacitor"]`. `docker-publish.yml` additionally filters `pull_request.branches: ["main"]` with `types: [closed]`, so it never fires for PRs into `antigravity`.
- **Impact**: no post-merge CI on the actual mainline; GitHub Pages deploy and Docker Hub publish only happen if someone pushes `main`; merged-PR docker publishing is dead. Unfiltered `pull_request` triggers on npm-test/visual-verification are the only live gates.
- **Fix**: switch push triggers to the default branch (or `branches: [main, antigravity]` during transition); decide whether `main` should be deleted or fast-forwarded; make deploy track the default branch.

### 4. Persistence backbone rides on three personal-fork git dependencies with branch specifiers
- **Severity**: high · **Category**: architecture (dependency risk)
- **Evidence**: `package.json:67-73`: `y-cinder: github:vrwarp/y-cinder#main`, `y-idb: github:vrwarp/y-idb#master`, `zustand-middleware-yjs: github:vrwarp/zustand-middleware-yjs#master`. Lockfile pins commits (`git+ssh://...#9c5c205e...`, `#e2a21f4...`, `#f284296...`) — good — but the manifest floats on branch heads, so any `npm install` (not `ci`) re-resolves. The forked `zustand-middleware-yjs` declares `yjs` and `zustand` as **regular dependencies** (lockfile: `deps: {'original-package-name': 'file:.', 'use-sync-external-store': ..., 'yjs': '^13.5.11', 'zustand': '^5.0.9'}`) rather than peers; the stray `original-package-name: file:.` entry shows hand-edited packaging. These three packages carry the entire CRDT persistence/sync layer (consumed by `src/store/yjs-provider.ts`, all ~12 yjs-wrapped stores, `src/lib/sync/FirestoreSyncManager.ts:11`, `CheckpointService.ts:5`).
- **Impact**: (a) CI that runs `npm install` (see Debt #5) can test different fork commits than developers have locked; (b) if root `yjs`/`zustand` ranges ever diverge from the fork's, npm installs a **second yjs instance** — Yjs explicitly breaks with duplicate instances, producing silent CRDT corruption, the worst possible failure mode for the source-of-truth layer; (c) builds depend on the availability and mutability of one personal GitHub account; (d) no upstream-tracking discipline (y-idb feature request doc in `docs/y-indexeddb-coalescing-feature-request.md` suggests divergence from upstream y-indexeddb).
- **Fix**: bring the forks in-repo as workspace packages (npm workspaces / `packages/y-cinder` etc.) or publish them under a scope with exact-version pins. Convert `yjs`/`zustand` to `peerDependencies` in the middleware fork. Add a CI assertion that exactly one `yjs` exists in the lockfile (`npm ls yjs`).

### 5. Non-reproducible CI installs (`npm install --legacy-peer-deps`) and install-flag drift
- **Severity**: high · **Category**: correctness (build reproducibility)
- **Evidence**: `npm-test.yml` → `npm install --legacy-peer-deps` (re-resolves git branch deps, may rewrite the lock in CI, skips peer validation). `Dockerfile.verification:11` → `npm ci --legacy-peer-deps`; `Dockerfile:11` and `deploy.yml` → plain `npm ci`. Node versions also drift: npm-test uses Node 22, deploy uses Node 20, `Dockerfile` uses node:20-alpine, `Dockerfile.android` installs Node 22. `package.json` has no `engines` field.
- **Impact**: the unit-test gate can pass against different dependency trees than what ships; `--legacy-peer-deps` masks a real peer conflict somewhere (undiagnosed); Node-version differences change V8/jsdom/Vite behavior between gates.
- **Fix**: `npm ci` everywhere; identify the peer conflict and resolve via `overrides` (then drop `--legacy-peer-deps`); add `"engines": { "node": ">=22 <23" }` plus `.nvmrc`, and use it in all workflows/Dockerfiles. Pin the Playwright Docker tag to the locked `@playwright/test` version mechanically (both are 1.60 today only by convention).

### 6. PWA manifest is defined twice; the static one is broken; neither is installable-complete
- **Severity**: high · **Category**: correctness (PWA)
- **Evidence**: (a) `public/manifest.webmanifest` references `../icons/icon-48.webp` … `icon-512.webp` with `"type": "image/png"` — the `icons/` directory sits at **repo root**, not in `public/`, so these URLs 404 in any deployment; this manifest also lacks `name`/`start_url`/`display`. (b) `vite.config.ts:55-72` defines a second manifest via VitePWA (name, icons pwa-192/512) — the plugin emits its own `manifest.webmanifest`, colliding with the public file in `dist/`. (c) The VitePWA manifest itself has no `display`, `start_url`, `id`, or maskable icons, so even if it wins, Chromium installability is marginal. (d) `includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg']` (`vite.config.ts:54`) names three files that don't exist — `public/` actually has `favico.ico` (sic).
- **Impact**: whichever file wins the dist collision, installed-app icons/metadata are wrong or minimal; the duplication guarantees future edits land in the wrong place (this already happened — the webp icon set was built and then orphaned).
- **Fix**: delete `public/manifest.webmanifest` and the root `icons/` dir (or move icons into `public/` and reference them); make the VitePWA `manifest` block the single source with `display: 'standalone'`, `start_url`, maskable + monochrome icons; fix/remove `includeAssets`; rename `favico.ico`.

### 7. Offline caching is app-shell-only and the update flow is abrupt
- **Severity**: high · **Category**: architecture (PWA)
- **Evidence**: `src/sw.ts` precaches only the injected manifest (vite-plugin-pwa default glob `**/*.{js,css,html}`) and registers **no runtime caching routes**. Never cached: `public/fonts/*.ttf` (864 KB, `@font-face` in `src/index.css:2-15`), `public/dict/cedict.json` (14 MB, fetched at `src/hooks/useChineseDictionary.ts:19`), `public/piper/*` (WASM+data, loaded by `piper-utils.ts`), PWA icons/pngs. Update flow: `sw.ts:10-11` `skipWaiting()`+`clientsClaim()` with `registerType: 'autoUpdate'` and `cleanupOutdatedCaches()` (`sw.ts:8`); `virtual:pwa-register` is unused (no update toast/reload prompt anywhere in `src/`).
- **Impact**: the "local-first, privacy-centric" reader loses Chinese dictionary, Piper TTS, and custom fonts when offline — exactly the features a local-first reader should keep. The update flow swaps the SW mid-session and deletes old precache entries; today that's survivable only because there is **no code splitting** (Debt #8) — the moment lazy routes are introduced, in-flight `import()` of old hashed chunks will 404 after an update. `maximumFileSizeToCacheInBytes: 4 * 1024 * 1024` (`vite.config.ts:52`) was raised from the 2 MiB default, which is itself evidence a single precached JS chunk exceeds 2 MiB.
- **Fix**: add Workbox runtime routes (CacheFirst for `/fonts/`, `/dict/`, `/piper/`, StaleWhileRevalidate for icons); adopt `registerType: 'prompt'` + `virtual:pwa-register` update toast (or keep autoUpdate but reload on `controllerchange`); revisit after code splitting lands.

### 8. No route/component code splitting; heavyweight deps are all in the entry chunk
- **Severity**: high · **Category**: performance
- **Evidence**: zero `React.lazy` in `src/` (grep). `src/App.tsx` statically imports `LibraryView`, `ReaderView` (→ `epubjs`, whose dep tree includes `core-js`, full `lodash`, `localforage`, `jszip` per lockfile), `FirestoreSyncManager` (→ `firebase` ^11), `DriveScannerService`, plus every store. The only dynamic imports are cycle-breakers (`src/store/yjs-provider.ts:65-150`) and `opencc-js`/`pinyin-pro` (`src/lib/chinese/ChineseTextProcessor.ts:9-17`). Workers are properly split (`vite.config.ts:24-29`). The precache size limit had to be doubled to 4 MiB (see Debt #7).
- **Impact**: multi-MB first load and SW precache on every update for a reading app whose landing view is a book grid; Firebase ships to users who never enable sync; epubjs ships to the library view.
- **Fix**: route-level `React.lazy` for ReaderView/Library panels/settings dialogs; dynamic-import firebase behind sync enablement (FirestoreSyncManager already lazily constructed via `getFirestoreSyncManager()` — the import is what's eager); `build.rollupOptions.output.manualChunks` for vendor groups; budget assertions via the existing ANALYZE tooling (e.g. CI size-limit check).

### 9. App boot hard-gates on the service worker; covers are served through an SW/IndexedDB side channel with duplicated magic strings
- **Severity**: high · **Category**: architecture
- **Evidence**: `src/App.tsx:106-117` blocks all rendering until `waitForServiceWorkerController()` finishes; `src/lib/serviceWorkerUtils.ts` waits up to 3 s for `serviceWorker.ready` then polls `controller` 8 times with exponential backoff (5→640 ms ≈ another 1.3 s). It **never rejects** (all code paths `return`), so the `swError`/"Critical Error" branch in `App.tsx:110-113,326-341` and half of `App_SW_Wait.test.tsx` test dead code. `playwright.config.ts:62-73` documents this gate adding ~2-3 s per page load when SWs are blocked. The covers URL `'/__versicle__/covers/'` is hardcoded in 5 places across 4 subsystems: `src/sw.ts:15`, `src/components/library/BookListItem.tsx:67`, `src/components/library/BookCover.tsx:28`, `src/lib/tts/AudioPlayerService.ts:326`, `src/store/selectors.ts:145,345`. `src/sw-utils.ts:3-26` duplicates DB schema knowledge (`EpubLibraryDB`, `static_manifests`, legacy `books` fallback — the fallback itself is fossil evidence that a schema migration once broke the SW).
- **Impact**: hard reloads (controller stays null), private windows, and SW-hostile contexts cost every user ~1.3-4.3 s of spinner and then show broken covers anyway (404s); persistence-schema migrations must remember to update the SW in lockstep; the magic string is unrefactorable safely.
- **Fix**: stop gating boot on the controller (render UI; covers can retry/fallback). Extract a single `coverUrl(bookId)` helper module imported by both SW and app, or replace the SW endpoint with blob-URL/object-URL management in the library layer. If the SW endpoint stays, move the IDB access behind the same `src/db` constants the app uses (import shared constants into the SW bundle — it's bundled by Vite, this is safe).

### 10. Install-time string-patching of the Piper worker (`prepare-piper`)
- **Severity**: medium · **Category**: architecture (build fragility)
- **Evidence**: `package.json:14` copies `piper_phonemize.{js,wasm,data}` + `worker/piper_worker.js` from `node_modules/piper-wasm` into `public/piper/`; `scripts/patch_piper_worker.js` applies 6 anchor-string replacements (config-file injection, phoneme-ID clamping, error handlers, try/catch wrappers, even a JSDoc-only patch #4). On anchor mismatch most patches `console.warn` and the script **exits 0** (only a missing file is fatal, lines 10-13), so a piper-wasm upgrade silently produces an unpatched worker. The result is a runtime-loaded classic worker outside the build graph (`piper-utils.ts:292`), unhashed and uncached.
- **Impact**: invisible behavioral regressions on dependency upgrade; `public/piper` is gitignored so the actual shipped code exists only post-install; two patch mechanisms (patch-package and this) for the same problem class.
- **Fix**: vendor the patched `piper_worker.js` as checked-in source (it's stable; piper-wasm 0.1.4 is years old) or fork piper-wasm properly; fail the script hard on any unapplied patch; long-term, move Piper inference into the Vite worker pipeline.

### 11. Dependency hygiene: dead, misplaced, and deprecated packages
- **Severity**: medium · **Category**: hygiene
- **Evidence**: `husky ^9.1.7` in **dependencies** (`package.json:50`) with no `.husky/` directory and no `prepare` script — fully dead. `vite-plugin-pwa` in dependencies (`:66`) — build tooling in the runtime dep set. `patch-package` in devDependencies (`:101`) yet `postinstall` requires it → `npm ci --omit=dev` fails. Deprecated stub types: `@types/dompurify` (`:82`), `@types/jszip` (`:84`), `@types/uuid` (`:91`) — all three libs ship their own types. `epubjs ^0.3.93` is unmaintained upstream (needs the `@xmldom/xmldom: ^0.8.13` security override at `:118-120`). The `"tests"` script (`:12`) duplicates `"test"`.
- **Impact**: confusing prod/dev split, broken production-only installs, lockfile noise; epubjs is a long-term strategic liability (flagged for the reader subsystem, but the pin/override lives here).
- **Fix**: move husky out or delete it; move vite-plugin-pwa to devDeps; either move patch-package to deps or accept dev-install-only; drop the three stub @types; document the epubjs override rationale next to the override.

### 12. Android config drift and dead manifest entries
- **Severity**: medium · **Category**: correctness (Android)
- **Evidence**: `android/app/build.gradle:5` hardcodes `compileSdk 36` while `android/variables.gradle` declares `compileSdkVersion = 35` (now unused); `Dockerfile.android:29-30` installs only `platforms;android-35` + `build-tools;35.0.0` (relies on Gradle auto-downloading SDK 36 mid-build — network nondeterminism); `scripts/install_android_sdk.sh:13` installs android-34/build-tools 34. `AndroidManifest.xml:40-48` declares `io.capawesome.capacitorjs.plugins.foregroundservice.AndroidForegroundService` + `NotificationActionBroadcastReceiver`, but no capawesome foreground-service plugin exists in `package.json` or `android/capacitor.settings.gradle` (only `@capawesome-team/capacitor-android-battery-optimization`) — dead entries from an abandoned integration; the media session foreground service actually used is `io.github.jofr.capacitor.mediasessionplugin.MediaSessionService` (see `MainActivityTest.java`). `variables.gradle` also carries `rgcfaIncludeGoogle` / `androidxCredentialsVersion` for `@capacitor-firebase/authentication`, which is not installed. `versionCode 1 / versionName "1.0"` are unmanaged. `android/app/google-services.json` is committed (Firebase Android client IDs + API key — acceptable per Google guidance, but worth a deliberate decision).
- **Impact**: three different SDK versions across build paths; docker Android builds depend on undeclared SDK downloads; dead manifest/service entries confuse every future Android change; release versioning impossible as-is.
- **Fix**: single-source SDK versions in `variables.gradle` and use them; align Dockerfile SDK install with `compileSdk`; delete capawesome manifest entries and the firebase-auth gradle vars; derive `versionCode` from CI; document the google-services.json decision.

### 13. Root-directory strays: dead scripts, live-but-orphaned tests, and untypechecked configs
- **Severity**: medium · **Category**: hygiene / type-safety
- **Evidence**: repo root contains `test-backup.ts`, `test-yjs.js` (dead manual scripts importing `src/`), `test-missing-notes.test.ts`, `test_use_local_storage_events.test.tsx`, `use-local-storage-other-tab.test.ts` (picked up by vitest's default include since they match `*.test.*` at root), `test_files.txt` (a stale file list), `getDeviceId_perf.md` (a perf note), `verification_script.py` (defunct pytest-era script), `jules_run_verification.sh` (`sudo` wrapper). Typecheck coverage: `tsconfig.app.json:26` excludes all `*.test.*`; `tsconfig.node.json:23` includes **only** `vite.config.ts` — so `vitest.config.ts`, `playwright.config.ts`, `capacitor.config.ts`, `scripts/*.js`, the root test files, and all 246 `src/**/*.test.*` files are typechecked by **nothing** (`tsc -b` skips them; vitest doesn't typecheck).
- **Impact**: tests can silently rot to invalid TS; root tests live outside any owner's view; strays mislead agents (and humans) about current practice.
- **Fix**: delete dead strays; move live root tests next to their subjects under `src/`; add a `tsconfig.test.json` (or vitest `typecheck`) covering tests, and extend `tsconfig.node.json` include to all root configs + `scripts/`.

### 14. Dead Tailwind v3 config duplicating the live v4 `@theme`
- **Severity**: medium · **Category**: dead-code
- **Evidence**: Tailwind 4 via `@import "tailwindcss"` + `@theme` in `src/index.css:1,16-63`; no `@config` directive anywhere, so `tailwind.config.js` is never loaded by Tailwind v4. The JS config duplicates the color-variable mappings already in `@theme` and defines a `breathing` animation used nowhere (grep: zero `animate-breathing`). `postcss.config.js` includes `autoprefixer`, redundant with `@tailwindcss/postcss` (Lightning CSS handles prefixing).
- **Impact**: edits to the dead file silently no-op — a guaranteed future time-sink.
- **Fix**: delete `tailwind.config.js`; drop `autoprefixer` from postcss config (verify no non-Tailwind CSS needs it).

### 15. CSP/security headers duplicated five times with drift potential
- **Severity**: medium · **Category**: duplication
- **Evidence**: identical CSP string in `nginx.conf:12`, `:28`, `:41` and `vite.config.ts:35` (preview); the policy allows `script-src 'unsafe-inline' 'unsafe-eval' blob:` (broad — `wasm-unsafe-eval` would likely suffice for the WASM use cases) plus `connect-src https:` (any HTTPS origin). `nginx.conf:32-42` also caches all `.js` for 1y, which includes `sw.js`/`registerSW.js` (saved only by the browser's 24h SW-script cap and `updateViaCache` default).
- **Impact**: any CSP change must be made in 4+ places; the wide policy undercuts its own purpose; SW caching headers are accidentally-correct.
- **Fix**: single nginx `map`/include for the header set; explicit `location = /sw.js { add_header Cache-Control "no-cache"; }` (same for `registerSW.js`, `manifest.webmanifest`, `index.html`); tighten `unsafe-eval` → `wasm-unsafe-eval` and enumerate connect-src origins.

### 16. Verification tooling docs describe a defunct pytest flow; misc script rot
- **Severity**: low · **Category**: hygiene
- **Evidence**: `AGENTS.md` instructs running `verification/test_journey_sync.py`, `-n 0`, pytest flags; `run_verification.sh --help` documents `verification/run_all.py`, `pytest -k/-m`, `--update-snapshots`; `README.md:178` shows `docker run ... /app/verification/test_journey_reading.py` — but `verification/` contains zero `.py` tests (88 entries, all `.spec.ts`/assets; only stray `verification_script.py` at root). `scripts/README.md` documents a nonexistent `generate_pwa_icons.py` and none of the three real scripts. `public/README.md` references `vite.svg` (absent) and omits `dict/`, `fonts/`, `piper/`. `public/alice.epub` duplicates `public/books/alice.epub` (188 KB each, both shipped). `verification/docker_entrypoint.sh:2` `set -e` makes the `EXIT_CODE` capture and `kill $PID` cleanup (lines 27-33) unreachable on failure. `src/workers/README.md` says the search worker wraps FlexSearch; `flexsearch` is not a dependency.
- **Impact**: agents (the primary workforce here) follow these docs literally; every drifted doc is a misdirection that costs an iteration.
- **Fix**: rewrite AGENTS.md/READMEs against reality as part of the overhaul's doc pass; delete the duplicate epub; fix the entrypoint trap.

### 17. patch-package patch covers only the ESM dist of `@capgo/capacitor-social-login`
- **Severity**: low · **Category**: correctness (latent)
- **Evidence**: `patches/@capgo+capacitor-social-login+7.20.0.patch` adds `login_hint` to `dist/esm/google-provider.js` only; the package's CJS bundle and `.d.ts` are untouched, and the dep is semver-floating (`^7.20.0`, `package.json:26`) — a 7.21.0 release makes patch-package fail or skip depending on strictness.
- **Impact**: TS doesn't know about `login_hint` (callers must cast); a minor upstream bump breaks installs; the feature belongs upstream.
- **Fix**: pin the exact version while patched; patch the `.d.ts` too; upstream the `login_hint` PR (it's a 5-line change) and drop the patch.

## Problematic couplings

- **SW → persistence schema**: `src/sw-utils.ts:3-26` hardcodes `EpubLibraryDB`, `static_manifests`, legacy `books` store names, duplicating `src/db/DBService` knowledge; persistence migrations must update the SW in lockstep (the legacy fallback proves drift already occurred once).
- **Library UI / TTS / stores → SW URL**: `/__versicle__/covers/` string in `src/components/library/BookCover.tsx:28`, `BookListItem.tsx:67`, `src/lib/tts/AudioPlayerService.ts:326`, `src/store/selectors.ts:145,345`, `src/sw.ts:15` — five copies across four subsystems.
- **App entry → verification suite**: `src/main.tsx:34-112` exposes four stores on `window` and embeds ~80 lines of TTS worker smoke-test harness for Playwright; test scaffolding compiled into the production entry chunk.
- **Boot sequence → everything**: `src/App.tsx` interleaves platform concerns (SW gating) with sync boot (MigrationStateService/CheckpointService interceptors), device registration, Drive scanning, and store hydration in one component — the platform gate is the first domino in a fragile chain.
- **Build pipeline → TTS provider internals**: `prepare-piper` (package.json) + `scripts/patch_piper_worker.js` must mirror `src/lib/tts/providers/piper-utils.ts` expectations about `/piper/piper_worker.js` message protocol.
- **nginx ↔ vite dev proxy**: `/__/auth` Firebase auth proxy logic duplicated between `nginx.conf:44-50` and `vite.config.ts:85-101` (different mechanisms, same contract with the sync/auth subsystem).

## What's good (keep)

- **injectManifest TS service worker** compiled through Vite — typed SW source, no Workbox-generated black box.
- **ES-module worker format with documented rationale** (`vite.config.ts:24-29`) and the worker-chunk code-splitting it enables; `ANALYZE=true` dual visualizer (main + worker treemaps) is a genuinely good, recent addition.
- **Lockfile pins exact fork commits** — keep until the forks are vendored.
- **Security `overrides`** for `@xmldom/xmldom` and `brace-expansion` — deliberate vuln pinning.
- **Capacitor config posture**: `androidScheme: 'https'`, `cleartext: false`, `allowNavigation: []` — correct and well-commented.
- **Docker layering**: `COPY package*.json + scripts` before `npm ci` (postinstall needs `scripts/`), nginx envsubst template for `FIREBASE_AUTH_DOMAIN` — both are sound patterns.
- **Playwright config with archaeology comments** (`playwright.config.ts:62-81`): the WebKit SW/timeout/retry rationale is exactly the kind of recorded institutional knowledge this codebase needs more of.
- **`run_verification.sh` encapsulation**: Docker-contained E2E with `--ipc=host` (documented why), screenshot mounting, webkit serialization heuristics.
- **Vite dev `/__/auth` proxy with cookie-domain stripping** — solves a real Firebase local-dev problem cleanly.
- **Strict TS app config** (`strict`, `noUnusedLocals/Parameters`, `verbatimModuleSyntax`).
- **eslint flat config with worktree ignores** — right idea (vitest just needs the same fix in the right file).

## Target design

1. **One config per concern, zero duplicates.** `vite.config.ts` (build only) + `vitest.config.ts` (merges vite config; owns all test discovery/excludes) + `playwright.config.ts`. Delete the vite `test` block, `tailwind.config.js`, `public/manifest.webmanifest`, root strays. All root configs and `scripts/` typechecked via an expanded `tsconfig.node.json`; tests typechecked via `tsconfig.test.json` wired into CI.
2. **Workspace-vendored forks.** npm workspaces: `packages/y-cinder`, `packages/y-idb`, `packages/zustand-middleware-yjs` checked into the repo (history imported), root app depends on `"workspace:*"`-style file links; `yjs`/`zustand` become peers; CI asserts a single `yjs` instance. patch-package retained only for the capgo patch until upstreamed; the piper worker becomes checked-in vendored source served from `public/piper/` (no install-time mutation).
3. **PWA done properly.** Single VitePWA manifest (standalone, start_url, maskable icons); runtime caching routes for fonts/dict/piper; `registerType: 'prompt'` with an update toast via `virtual:pwa-register/react`; SW no longer gates boot; covers served via a single `coverUrl()` module shared by SW and app (or replaced by object URLs); SW imports DB constants from `src/db`.
4. **Split bundles.** Route-level lazy ReaderView/settings; firebase and epubjs out of the entry chunk; manualChunks vendor groups; CI bundle-size budget using the existing ANALYZE tooling.
5. **CI that matches reality.** All workflows trigger on the default branch (`antigravity` or a renamed `main`); `npm ci` + pinned Node (engines + .nvmrc) everywhere; android Docker build restored (per-Dockerfile ignore files) and exercised on a schedule; Playwright image tag derived from the lockfile.
6. **Single security-header source** (nginx include + tightened CSP), explicit no-cache for `sw.js`/manifest/index.html.
7. **Docs pass**: AGENTS.md/READMEs rewritten to the Playwright/Docker truth; scripts/README documents the three real scripts.

## Migration notes

- **No user-data migrations required** by this subsystem's fixes — the SW cover endpoint and DB names must keep working throughout; if the covers mechanism is replaced with object URLs, ship both paths for one release (SW endpoint kept as fallback), then remove.
- **SW update-flow change** (autoUpdate → prompt): deploy the runtime-caching SW *before* introducing code splitting, so the chunk-404-after-update hazard never goes live. `cleanupOutdatedCaches` keeps old caches until activation; no special migration needed beyond one ordinary update cycle.
- **Fork vendoring**: import each fork repo with history (`git subtree add`), switch `package.json` to file/workspace refs, regenerate the lockfile, and diff `npm ls yjs zustand firebase` before/after to prove no duplicate instances. Do this in one PR with no behavior changes.
- **Vitest config merge**: land as a standalone PR; verify `vitest list` output is identical (minus `.claude`/strays) before and after.
- **`.dockerignore` fix**: split into per-Dockerfile ignore files in the same PR that adds a CI job building `Dockerfile.android`, so the fix is proven.
- **Branch/CI rename**: either fast-forward `main` to `antigravity` and make `main` default (smallest workflow diff), or update all five workflow trigger lists; coordinate with GH Pages deployment expectations.
- **manifest consolidation**: removing `public/manifest.webmanifest` changes installed-PWA identity fields; keep `name`/`short_name` stable so existing installs don't duplicate.
- **prepare-piper removal**: check in the current post-patch `public/piper/` artifacts first (verify byte-identical to script output), then delete the postinstall step; piper behavior is unchanged by construction.
