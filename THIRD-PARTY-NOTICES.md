# Third-Party Notices

<!-- GENERATED FILE — do not edit by hand. Regenerate with `npm run licenses:generate`
     (scripts/generate-third-party-notices.mjs). Inputs: third-party/inventory.json +
     the production npm dependency tree. -->

Versicle is licensed under **GPL-3.0-or-later** (see `LICENSE`). This is the
license *floor* for the combined work, not a stylistic choice:
`@jofr/capacitor-media-session` (GPL-3.0-or-later) and the espeak-ng code/data
embedded in the shipped Piper WASM blobs (GPL-3.0) make any permissive
relicensing a violation. `ua-parser-js` v2 (AGPL-3.0-or-later) additionally
carries network-source obligations. Details: `third-party/inventory.json`.

Versicle redistributes the third-party components below. Full license texts
for npm packages ship inside each package (`node_modules/<name>/LICENSE`) and
are not duplicated here.

## Vendored, forked & non-npm artifacts

From `third-party/inventory.json` (authoritative for provenance and modifications):

### espeak-ng (code + voice data embedded in piper_phonemize.wasm/.data)

- **Version:** UNKNOWN — needs investigation (exact espeak-ng commit not recorded by upstream piper-wasm build)
- **License:** GPL-3.0-or-later
- **Source:** https://github.com/espeak-ng/espeak-ng
- **Path:** third-party/piper/piper_phonemize.wasm, third-party/piper/piper_phonemize.data (git-tracked; copied to dist/piper/ at build by the vite piper-vendor plugin)
- **Provenance:** Compiled into piper_phonemize.wasm and packed into piper_phonemize.data (Emscripten FS image of espeak-ng-data) by the upstream DavidCks/piper-wasm build, which states it followed the wide-video/piper-wasm recipe; the exact espeak-ng and piper-phonemize commits are recorded nowhere. GPLv3 §6 corresponding source is therefore currently unidentifiable — long-term fix is rebuilding the WASM from pinned commits in CI (gap report D3). Vendored into git at Phase 5a-PR3 (verbatim blobs from piper-wasm@0.1.4; SHA-256 hashes in third-party/piper/PROVENANCE.md).
- **Notes:** piper-wasm's blanket 'MIT' package.json claim does not cover these blobs — the binary links GPL-3 espeak-ng, so the artifact is GPL-governed.

### piper-phonemize (compiled into piper_phonemize.wasm)

- **Version:** UNKNOWN — needs investigation (exact commit not recorded by upstream piper-wasm build)
- **License:** MIT
- **Source:** https://github.com/rhasspy/piper-phonemize
- **Path:** third-party/piper/piper_phonemize.wasm (git-tracked; ships in dist/piper/)
- **Provenance:** Compiled to WASM by the upstream DavidCks/piper-wasm build; exact source commit unrecorded (same build chain as the espeak-ng entry). Vendored into git at Phase 5a-PR3.

### piper-wasm build artifacts (piper_phonemize.js loader + piper_worker.js)

- **Version:** 0.1.4 (piper-wasm npm package, vendored — the npm dependency was removed at Phase 5a-PR3)
- **License:** MIT (wrapper/loader code; embedded espeak-ng payload is GPL-3.0 — see espeak-ng entry)
- **Source:** https://github.com/DavidCks/piper-wasm
- **Path:** third-party/piper/piper_phonemize.js, third-party/piper/piper_worker.js (git-tracked; ship in dist/piper/)
- **Provenance:** Vendored into git at Phase 5a-PR3 from piper-wasm@0.1.4 build/ output (upstream hashes in third-party/piper/PROVENANCE.md). piper_worker.js is COMMITTED PATCHED SOURCE: the 6 string patches formerly applied at install time by the deleted scripts/patch_piper_worker.js are baked in, plus a Versicle-authored request-id envelope (patch 7) for PiperRuntime's stale-reply protocol.
- **Modifications:** piper_worker.js: config injection, phoneme-ID clamping, error handling (the former install-time patch set), and the request-id envelope — full patch list in third-party/piper/PROVENANCE.md. CI smoke: src/lib/tts/providers/piperVendoredAssets.test.ts asserts the patch anchors are present.

### Versicle Sans Narrow (modified PT Sans Narrow Web: pinyin tone glyphs, renamed off OFL RFNs)

- **Version:** 2.003W (embedded name table)
- **License:** OFL-1.1
- **Source:** https://company.paratype.com/pt-sans-pt-serif (ParaType; also distributed via Google Fonts)
- **Path:** public/fonts/VersicleSansNarrow-Regular.ttf, public/fonts/VersicleSansNarrow-Bold.ttf
- **Provenance:** ParaType PT Sans Narrow Web 2.003W; pinyin tone glyphs (ǎ ǐ ǒ ǔ ǚ) were programmatically injected into the TTF binaries using Python fonttools (script lost, pre-repo — the injected binaries are the canonical source artifacts: sha256 35a9cce169015258e452d8c55402865efc64bedb4c816ad8a721e01556d29955 Regular / 5e6e50f5ec2138a31ad97dfad8881d69ccc386fcbb3308c0a1f5377de743b543 Bold, retrievable from git history at the Phase 8 rename commit). The shipped files are derived from those binaries by the COMMITTED scripts/build-pinyin-font.py (fontTools): name-table-only rewrite, glyf/cmap byte-equality asserted, pinned by src/test/pinyin-font.test.ts.
- **Modifications:** Glyph injection as above, then Phase 8 §I OFL-RFN rename (closes gap report D2): family/full/PostScript names and filenames renamed to Versicle Sans Narrow, the ParaType trademark record deleted, the description rewritten RFN-free. RETAINED per OFL-1.1: the ParaType copyright (nameID 0, with a modification note appended) and the full OFL license text incl. its Reserved Font Name declaration (nameID 13) — required notices; the RFN strings inside those records are provenance text, not naming use. No persisted user-preference migration: no shipped UI ever wrote the legacy family; the reader theming applies a read-time normalization (normalizeFontFamily in src/domains/reader/engine/epubTheming.ts).
- **Notes:** OFL-1.1 compliant as a Modified Version: renamed off the Reserved Font Names, license text and copyright ride inside the TTF name table, so license text accompanies copies.

### CC-CEDICT (compiled Chinese-English dictionary)

- **Version:** vendored MDBG snapshot scripts/cedict-source.zip, pinned + sha256-verified by scripts/cedict.lock.json (exact release date/entry count shipped in the public/dict/cedict.meta.json sidecar — release 2026-06-16 at vendoring time)
- **License:** CC-BY-SA-4.0
- **Source:** https://www.mdbg.net/chinese/dictionary?page=cc-cedict
- **Path:** scripts/cedict-source.zip (vendored source, committed) → public/dict/cedict.json + cedict.meta.json (generated offline, git-ignored since Phase 6 PR-12; built in CI and dev bootstrap via `npm run compile-dict`; ships in dist/dict/)
- **Provenance:** The source export is VENDORED in-repo (scripts/cedict-source.zip), pinned + sha256-verified by scripts/cedict.lock.json; the original CC-BY-SA license/copyright header rides inside the .zip so the license accompanies the redistributed copy. Compiled OFFLINE at build time by scripts/compile-dict.cjs (no mdbg.net dependency — MDBG rotates its 'latest' export ~daily, so pinning that moving URL was fragile); the '#' header (license declaration + release metadata) is parsed and RETAINED as the cedict.meta.json sidecar. Upgrades are a deliberate, reviewed step (compile-dict.cjs --update-lock, automated monthly via .github/workflows/update-dict.yml). The silent mock-dictionary fallback was deleted (failure is fatal; --mock writes only the test fixture src/test/fixtures/dict/cedict.mock.json).
- **Modifications:** Format conversion to JSON lookup table; license/provenance header retained as sidecar (gap report D5 closed at Phase 6 PR-12). Source export vendored in-repo for reproducible, offline builds.
- **Notes:** Attribution + ShareAlike statement present in README.md and two in-app credits surfaces; cedict.meta.json carries sourceUrl/license/releaseDate/entry counts/sha256s for the credits surfaces (P8 reads it).

### trad2simp single-character table (derived from OpenCC dictionary data via opencc-js)

- **Version:** generated from opencc-js@1.0.5 (regenerate via `npm run generate-trad2simp` on opencc-js upgrades)
- **License:** Apache-2.0
- **Source:** https://github.com/nk2028/opencc-js (dictionary data from https://github.com/BYVoid/OpenCC)
- **Path:** src/domains/chinese/vocabulary/trad2simp.json (+ trad2simp.meta.json sidecar; bundles into dist/)
- **Provenance:** Generated by scripts/generate-trad2simp.mjs from the opencc-js cn<->tw converters (pass 1: inverse of the display mapping; pass 2: direct tw->cn). Committed and reviewed like source because it feeds the deterministic CRDT v7 vocabulary canonicalization (Phase 6 PR-13); sidecar src/domains/chinese/vocabulary/trad2simp.meta.json records counts + rationale.
- **Modifications:** Single-character extraction from the OpenCC phrase dictionaries; multi-character conversions excluded.
- **Notes:** opencc-js itself is already a production npm dependency covered by the license gate; this entry records the DERIVED committed artifact.

### y-cinder (fork of PodRaven/y-fire)

- **Version:** 3.0.2606100319, git dependency pinned to e1e946408928119837c3a68b474da2def6bf0a69
- **License:** MIT
- **Source:** https://github.com/vrwarp/y-cinder (upstream: https://github.com/podraven/y-fire)
- **Path:** node_modules/y-cinder (git dependency; ships built dist/ produced by its prepare hook)
- **Provenance:** Personal fork consumed as a git dependency (git+https://github.com/vrwarp/y-cinder.git#e1e9464), upstreamed from the formerly-vendored copy: the fork surgery (saved/sync events, the compaction inline-content fix) plus the correctness/performance overhaul now live in the fork repo, which builds its dist on install via a `prepare` hook. Retains the upstream MIT LICENSE ('Pod Raven 2024') verbatim plus the fork-of readme header; full lineage and the fork modification log live in the fork repo's PROVENANCE.md.
- **Modifications:** None in-repo — the fork now lives entirely upstream. The app consumes the published dist; behavior is pinned by the relocated contract suite in test/vendor-contracts/y-cinder/ and the fork's own CI.
- **Notes:** MIT fork; covered by the license allowlist as a normal production dependency. The in-tree LICENSE record is retained upstream in the fork repo.

### y-idb (fork of yjs/y-indexeddb)

- **Version:** 9.1.0, git dependency pinned to 60379ae5e4af7efd8305969db4cb9db8dcc89efb
- **License:** MIT
- **Source:** https://github.com/vrwarp/y-idb (upstream: https://github.com/yjs/y-indexeddb)
- **Path:** node_modules/y-idb (git dependency; ES source via the import condition, declarations built on install)
- **Provenance:** Personal fork consumed as a git dependency (git+https://github.com/vrwarp/y-idb.git#60379ae), upstreamed from the formerly-vendored copy: the snapshot/durability fork surgery lives in the fork repo, which builds its dist (incl. the tsc-emitted declarations) on install via a `prepare` hook. The app resolves the ES source via the package's `import` condition. Retains the upstream MIT LICENSE (Kevin Jahns / RWTH Aachen) verbatim; full lineage and the fork modification log live in the fork repo's PROVENANCE.md.
- **Modifications:** None in-repo — the fork now lives entirely upstream. Behavior is pinned by the relocated contract suite in test/vendor-contracts/y-idb/ and the fork's own CI.
- **Notes:** MIT fork; covered by the license allowlist as a normal production dependency. The in-tree LICENSE record is retained upstream in the fork repo.

### zustand-middleware-yjs (fork of joebobmiles/zustand-middleware-yjs)

- **Version:** 1.3.1, git dependency pinned to 6a0cff9d9c5f890f6f0fa8f0aec389febe4e6779
- **License:** MIT
- **Source:** https://github.com/vrwarp/zustand-middleware-yjs (upstream: https://github.com/joebobmiles/zustand-middleware-yjs)
- **Path:** node_modules/zustand-middleware-yjs (git dependency; ships built dist/ produced by its prepare hook)
- **Provenance:** Personal fork consumed as a git dependency (git+https://github.com/vrwarp/zustand-middleware-yjs.git#6a0cff9), upstreamed from the formerly-vendored copy: the CRDT fork surgery lives in the fork repo, which builds its dist on install via a `prepare` hook. Retains the upstream MIT LICENSE (Joseph R Miles) verbatim; full lineage and the fork modification log live in the fork repo's PROVENANCE.md.
- **Modifications:** None in-repo — the fork now lives entirely upstream. The app consumes the published dist; behavior is pinned by the relocated contract suite in test/vendor-contracts/zustand/ and the fork's own CI.
- **Notes:** MIT fork; the published package.json keeps private:true but the git dependency is still consumed normally. Covered by the license record; the in-tree LICENSE is retained upstream in the fork repo.

### @jofr/capacitor-media-session (vendored fork: Media3 migration + versicle device fixes)

- **Version:** 4.0.0, vendored from vrwarp/capacitor-media-session@2f8c6fa20eca5ea449c1a54514eb7001279d1b07 (branch antigravity)
- **License:** GPL-3.0-or-later
- **Source:** https://github.com/vrwarp/capacitor-media-session (upstream: https://github.com/jofr/capacitor-media-session)
- **Path:** packages/capacitor-media-session (git-tracked incl. committed dist/; consumed via the file: dependency in package.json)
- **Provenance:** Vendored in-repo as a file: dependency (packages/capacitor-media-session) instead of the prior git+https pin. Upstream jofr is the legacy androidx.media plugin; the vrwarp fork migrates Android to AndroidX Media3 (media3-session/common 1.2.0) via a WebViewProxyPlayer (SimpleBasePlayer). Retains the upstream GPL-3.0-or-later LICENSE verbatim. Full lineage and the exact local modifications are in packages/capacitor-media-session/PROVENANCE.md.
- **Modifications:** Android-only device fixes (upstreamable): MediaSessionService.onCreate now calls addSession() so the Media3 foreground notification posts; onStartCommand returns START_NOT_STICKY and onTaskRemoved stops the idle service; MediaSessionPlugin.bitmapToByteArray downscales artwork to a 512px long edge and encodes JPEG q85 (Binder/AVRCP safety). Vendoring-only deltas (not upstreamed): dist/ is committed and the prepare hook removed (file: deps do not build on install). See PROVENANCE.md.
- **Notes:** GPL-3.0-or-later fork; this is the package cited in inventory.json#licenseFloor as a GPL-3 floor source. Covered by the license allowlist as a normal production dependency.

### @capgo/capacitor-social-login local patch (login_hint passthrough)

- **Version:** patch against 7.20.0
- **License:** MPL-2.0
- **Source:** https://github.com/Cap-go/capacitor-social-login
- **Path:** patches/@capgo+capacitor-social-login+7.20.0.patch
- **Provenance:** Hand-written patch-package diff modifying dist/esm/google-provider.js of the MPL-2.0 upstream; applied by postinstall. The patch file in this public repo is the MPL §3.2 source-availability mechanism for the modification. No upstream PR reference recorded (gap report D6 — should be upstreamed).
- **Modifications:** Adds login_hint plumbing to the Google OAuth provider (ESM dist only; CJS and .d.ts untouched).

### Alice's Adventures in Wonderland (demo EPUB, Project Gutenberg #11)

- **Version:** Project Gutenberg eBook #11 (edition/release date unrecorded)
- **License:** Public domain (Project Gutenberg License governs use of the embedded PG trademark text)
- **Source:** https://www.gutenberg.org/ebooks/11
- **Path:** public/alice.epub, public/books/alice.epub (byte-identical duplicates, both ship in dist/), src/test/fixtures/alice.epub, verification/alice.epub
- **Provenance:** Downloaded from Project Gutenberg; exact download date/edition unrecorded.

### Project Gutenberg test-fixture EPUBs (frankenstein, jane-eyre, pride-and-prejudice, room-with-a-view)

- **Version:** UNKNOWN — needs investigation (PG eBook numbers/editions unrecorded)
- **License:** Public domain (Project Gutenberg License governs use of the embedded PG trademark text)
- **Source:** https://www.gutenberg.org/
- **Path:** verification/frankenstein.epub, verification/jane-eyre.epub, verification/pride-and-prejudice.epub, verification/room-with-a-view.epub
- **Provenance:** Committed as Playwright E2E fixtures; exact Project Gutenberg editions and download dates unrecorded. Not distributed in any build output (verification/ is test-only).

### Google Drive product logo

- **Version:** 2020q4 brand asset (per filename)
- **License:** Proprietary — Google trademark/brand asset (not open-source licensed; used nominatively to identify the Google Drive integration)
- **Source:** https://about.google/brand-resource-center/ (exact download origin unrecorded)
- **Path:** public/logo_drive_2020q4_color_2x_web_64dp.png (used by src/components/settings/SyncSettingsTab.tsx; ships in dist/)
- **Provenance:** Google brand asset; exact origin and brand-guideline review unrecorded (gap report D9).

### Background-audio media assets (silence.ogg, 10s_8k_sub_bass_vbr_off.webm)

- **Version:** UNKNOWN
- **License:** UNKNOWN — needs investigation (likely first-party-generated trivial audio, but unrecorded)
- **Source:** UNKNOWN — needs investigation (src/assets/README.md does not document them)
- **Path:** src/assets/silence.ogg, src/assets/10s_8k_sub_bass_vbr_off.webm (bundled into dist/)
- **Provenance:** UNKNOWN — needs investigation. Fix per gap report D9: record origin or regenerate with a documented ffmpeg command.

### Bible book-name lexicon data (bible-lexicon.ts)

- **Version:** UNKNOWN
- **License:** UNKNOWN — needs investigation (content is factual abbreviation data, so copyright risk is minimal, but the citation is dead)
- **Source:** UNKNOWN — needs investigation (src/data/bible-lexicon.ts:73 cites a 'lexicon-bible.csv' that does not exist in the repo)
- **Path:** src/data/bible-lexicon.ts (2,899 lines of data; bundled into dist/)
- **Provenance:** UNKNOWN — needs investigation. Fix per gap report D9: commit the CSV or rewrite the comment as hand-assembled.

### Piper voice models (runtime-fetched, per-user)

- **Version:** rhasspy/piper-voices @ v1.0.0 (HuggingFace resolve tag)
- **License:** Heterogeneous per-voice dataset licenses (several upstream MODEL_CARDs are non-commercial or attribution-bearing); NOT redistributed by Versicle — fetched directly by the user's browser on demand
- **Source:** https://huggingface.co/rhasspy/piper-voices
- **Path:** (runtime fetch only; cached in user's browser storage)
- **Provenance:** Fetched at runtime from https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/ (src/lib/tts/providers/PiperProvider.ts). User-initiated download, not Versicle redistribution; the voice picker surfaces no per-voice license info (gap report D10 product gap).

### onnxruntime-web (vendored local runtime for Piper synthesis)

- **Version:** 1.17.1
- **License:** MIT
- **Source:** https://github.com/microsoft/onnxruntime
- **Path:** third-party/piper/onnxruntime/ (git-tracked; ships in dist/piper/onnxruntime/)
- **Provenance:** Vendored into git at Phase 5a-PR3: ort.min.js + ort-wasm{,-simd,-threaded,-simd-threaded}.wasm extracted verbatim from the npm registry tarball onnxruntime-web-1.17.1.tgz (SHA-256 d48e46a437bc11d6b3a30e587fbae8aaa5061b567230e9aeecb5bc5059fcbd02; recorded in third-party/piper/PROVENANCE.md). Replaces the former cdnjs runtime fetch (deleted with piper-utils.ts) so Piper synthesis performs zero third-party egress.

## Bundled npm packages (production dependency tree)

576 packages, grouped by license. The private
vendored forks `zustand-middleware-yjs` and `y-idb` (both MIT) are
excluded from the scan and recorded in the inventory section above.

### (AFL-2.1 OR BSD-3-Clause) (1)

- `json-schema@0.4.0` — Copyright (c) 2005-2015, The Dojo Foundation. All rights reserved. — <https://github.com/kriszyp/json-schema>

### (MIT AND Zlib) (1)

- `pako@1.0.11` — Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn — <https://github.com/nodeca/pako>

### (MIT OR CC0-1.0) (1)

- `type-fest@0.16.0` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https:/sindresorhus.com) — <https://github.com/sindresorhus/type-fest>

### (MIT OR GPL-3.0-or-later) (1)

- `jszip@3.10.1` — Copyright (c) 2009-2016 Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso — <https://github.com/Stuk/jszip>

### (MPL-2.0 OR Apache-2.0) (1)

- `dompurify@3.4.8` — Copyright Dr.-Ing. Mario Heiderich, Cure53 — <https://github.com/cure53/DOMPurify>

### 0BSD (1)

- `tslib@2.8.1` — Copyright (c) Microsoft Corporation. — <https://github.com/Microsoft/tslib>

### AGPL-3.0-or-later (1)

- `ua-parser-js@2.0.8` — Copyright (C) 2007 Free Software Foundation, Inc.. <https://fsf.org/> — <https://github.com/faisalman/ua-parser-js>

### Apache-2.0 (61)

- `@firebase/ai@1.4.1` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/analytics-compat@0.2.23` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/analytics-types@0.8.3` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/analytics@0.10.17` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/app-check-compat@0.3.26` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/app-check-interop-types@0.3.3` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/app-check-types@0.5.3` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/app-check@0.10.1` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/app-compat@0.4.2` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/app-types@0.9.3` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/app@0.13.2` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/auth-compat@0.5.28` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/auth-interop-types@0.2.4` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/auth-types@0.13.0` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/auth@1.10.8` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/component@0.6.18` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/data-connect@0.3.10` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/database-compat@2.0.11` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/database-types@1.0.15` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/database@1.0.20` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/firestore-compat@0.3.53` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/firestore-types@3.0.3` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/firestore@4.8.0` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/functions-compat@0.3.26` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/functions-types@0.6.3` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/functions@0.12.9` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/installations-compat@0.2.18` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/installations-types@0.5.3` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/installations@0.6.18` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/logger@0.4.4` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/messaging-compat@0.2.22` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/messaging-interop-types@0.2.3` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/messaging@0.12.22` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/performance-compat@0.2.20` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/performance-types@0.2.3` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/performance@0.7.7` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/remote-config-compat@0.2.18` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/remote-config-types@0.4.0` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/remote-config@0.6.5` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/storage-compat@0.3.24` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/storage-types@0.8.3` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/storage@0.13.14` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/util@1.12.1` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@firebase/webchannel-wrapper@1.0.3` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `@grpc/grpc-js@1.9.15` — Copyright Google Inc. — <https://github.com/grpc/grpc-node.git#master>
- `@grpc/proto-loader@0.7.15` — Copyright Google Inc. — <https://github.com/grpc/grpc-node>
- `@trickfilm400/rollup-plugin-off-main-thread@3.0.0-pre1` — Copyright Surma — <https://github.com/Trickfilm400/rollup-plugin-off-main-thread>
- `baseline-browser-mapping@2.9.11` — <https://github.com/web-platform-dx/baseline-browser-mapping>
- `class-variance-authority@0.7.1` — Copyright Joe Bell — <https://github.com/joe-bell/cva>
- `comlink@4.4.2` — Copyright Surma — <https://github.com/GoogleChromeLabs/comlink>
- `detect-libc@2.1.2` — Copyright Lovell Fuller — <https://github.com/lovell/detect-libc>
- `ejs@3.1.10` — Copyright Matthew Eernisse — <https://github.com/mde/ejs>
- `faye-websocket@0.11.4` — Copyright 2010-2021 James Coglan — <https://github.com/faye/faye-websocket-node>
- `filelist@1.0.6` — Copyright Matthew Eernisse — <https://github.com/mde/filelist>
- `firebase@11.10.0` — Copyright Firebase — <https://github.com/firebase/firebase-js-sdk>
- `jake@10.9.4` — Copyright Matthew Eernisse — <https://github.com/jakejs/jake>
- `localforage@1.10.0` — Copyright Mozilla — <https://github.com/localForage/localForage>
- `long@5.3.2` — Copyright Daniel Wirtz — <https://github.com/dcodeIO/long.js>
- `web-vitals@4.2.4` — Copyright Philip Walton — <https://github.com/GoogleChrome/web-vitals>
- `websocket-driver@0.7.4` — Copyright 2010-2020 James Coglan — <https://github.com/faye/websocket-driver-node>
- `websocket-extensions@0.1.4` — Copyright 2014-2020 James Coglan — <https://github.com/faye/websocket-extensions-node>

### BlueOak-1.0.0 (6)

- `glob@11.1.0` — Copyright Isaac Z. Schlueter — <https://github.com/isaacs/node-glob>
- `jackspeak@4.1.1` — Copyright Isaac Z. Schlueter — <https://github.com/isaacs/jackspeak>
- `lru-cache@11.2.4` — Copyright Isaac Z. Schlueter — <https://github.com/isaacs/node-lru-cache>
- `minimatch@10.2.5` — Copyright Isaac Z. Schlueter — <https://github.com/isaacs/minimatch>
- `package-json-from-dist@1.0.1` — Copyright Isaac Z. Schlueter — <https://github.com/isaacs/package-json-from-dist>
- `path-scurry@2.0.1` — Copyright Isaac Z. Schlueter — <https://github.com/isaacs/path-scurry>

### BSD-2-Clause (6)

- `epubjs@0.3.93` — Copyright (c) 2013, FuturePress — <https://github.com/futurepress/epub.js>
- `esutils@2.0.3` — <https://github.com/estools/esutils>
- `regjsparser@0.13.0` — Copyright (c) Julian Viereck and Contributors, All Rights Reserved. — <https://github.com/jviereck/regjsparser>
- `stringify-object@3.3.0` — Copyright (c) 2015, Yeoman team. All rights reserved. — <https://github.com/yeoman/stringify-object>
- `terser@5.44.1` — Copyright 2012-2018 (c) Mihai Bazon <mihai.bazon@gmail.com> — <https://github.com/terser/terser>
- `webidl-conversions@4.0.2` — Copyright (c) 2014, Domenic Denicola. All rights reserved. — <https://github.com/jsdom/webidl-conversions>

### BSD-3-Clause (16)

- `@protobufjs/aspromise@1.1.2` — Copyright (c) 2016, Daniel Wirtz  All rights reserved. — <https://github.com/dcodeIO/protobuf.js>
- `@protobufjs/base64@1.1.2` — Copyright (c) 2016, Daniel Wirtz  All rights reserved. — <https://github.com/dcodeIO/protobuf.js>
- `@protobufjs/codegen@2.0.5` — Copyright (c) 2016, Daniel Wirtz  All rights reserved. — <https://github.com/dcodeIO/protobuf.js>
- `@protobufjs/eventemitter@1.1.1` — Copyright (c) 2016, Daniel Wirtz  All rights reserved. — <https://github.com/dcodeIO/protobuf.js>
- `@protobufjs/fetch@1.1.1` — Copyright (c) 2016, Daniel Wirtz  All rights reserved. — <https://github.com/dcodeIO/protobuf.js>
- `@protobufjs/float@1.0.2` — Copyright (c) 2016, Daniel Wirtz  All rights reserved. — <https://github.com/dcodeIO/protobuf.js>
- `@protobufjs/inquire@1.1.2` — Copyright (c) 2016, Daniel Wirtz  All rights reserved. — <https://github.com/dcodeIO/protobuf.js>
- `@protobufjs/path@1.1.2` — Copyright (c) 2016, Daniel Wirtz  All rights reserved. — <https://github.com/dcodeIO/protobuf.js>
- `@protobufjs/pool@1.1.0` — Copyright (c) 2016, Daniel Wirtz  All rights reserved. — <https://github.com/dcodeIO/protobuf.js>
- `@protobufjs/utf8@1.1.1` — Copyright (c) 2016, Daniel Wirtz  All rights reserved. — <https://github.com/dcodeIO/protobuf.js>
- `fast-uri@3.1.2` — Copyright (c) 2011-2021, Gary Court until https://github.com/garycourt/uri-js/commit/a1acf730b4bba3f1097c9f52e7d9d3aba8cdcaae. Copyright (c) 2021-present The Fastify team <https://github.com/fastify/fastify#team>. All rights reserved. — <https://github.com/fastify/fast-uri>
- `protobufjs@7.6.2` — Copyright (c) 2016, Daniel Wirtz  All rights reserved. — <https://github.com/protobufjs/protobuf.js>
- `serialize-javascript@7.0.5` — Copyright 2014 Yahoo! Inc.. All rights reserved. — <https://github.com/yahoo/serialize-javascript>
- `source-map-js@1.2.1` — Copyright Valentin 7rulnik Semirulnik — <https://github.com/7rulnik/source-map-js>
- `source-map@0.6.1` — Copyright Nick Fitzgerald — <https://github.com/mozilla/source-map>
- `source-map@0.8.0-beta.0` — Copyright Nick Fitzgerald — <https://github.com/mozilla/source-map>

### CC-BY-4.0 (1)

- `caniuse-lite@1.0.30001762` — Copyright Ben Briggs — <https://github.com/browserslist/caniuse-lite>

### GPL-3.0-or-later (1)

- `@jofr/capacitor-media-session@4.0.0` — Copyright Jonas — <https://github.com/jofr/capacitor-media-session>

### ISC (32)

- `@capacitor/synapse@1.0.4` — Copyright (c) 2025 Ionic
- `@isaacs/cliui@8.0.2` — Copyright (c) 2015, Contributors — <https://github.com/yargs/cliui>
- `at-least-node@1.0.0` — Copyright Ryan Zimmerman — <https://github.com/RyanZim/at-least-node>
- `cliui@8.0.1` — Copyright (c) 2015, Contributors — <https://github.com/yargs/cliui>
- `d@1.0.2` — Copyright (c) 2013-2024, Mariusz Nowak, @medikoo, medikoo.com — <https://github.com/medikoo/d>
- `electron-to-chromium@1.5.267` — Copyright 2018 Kilian Valkhof — <https://github.com/kilian/electron-to-chromium>
- `es5-ext@0.10.64` — Copyright (c) 2011-2024, Mariusz Nowak, @medikoo, medikoo.com — <https://github.com/medikoo/es5-ext>
- `es6-symbol@3.1.4` — Copyright (c) 2013-2024, Mariusz Nowak, @medikoo, medikoo.com — <https://github.com/medikoo/es6-symbol>
- `esniff@2.0.1` — Copyright (c) 2013-2024, Mariusz Nowak, @medikoo, medikoo.com — <https://github.com/medikoo/esniff>
- `ext@1.7.0` — Copyright (c) 2011-2022, Mariusz Nowak, @medikoo, medikoo.com — <https://github.com/medikoo/es5-ext.git#ext>
- `foreground-child@3.3.1` — Copyright (c) 2015-2023 Isaac Z. Schlueter and Contributors — <https://github.com/tapjs/foreground-child>
- `get-caller-file@2.0.5` — Copyright Stefan Penner — <https://github.com/stefanpenner/get-caller-file>
- `get-own-enumerable-property-symbols@3.0.2` — Copyright (c) 2019, Shahar Or — <https://github.com/mightyiam/get-own-enumerable-property-symbols>
- `graceful-fs@4.2.11` — Copyright (c) 2011-2022 Isaac Z. Schlueter, Ben Noordhuis, and Contributors — <https://github.com/isaacs/node-graceful-fs>
- `idb@7.1.1` — Copyright Jake Archibald — <https://github.com/jakearchibald/idb>
- `idb@8.0.3` — Copyright Jake Archibald — <https://github.com/jakearchibald/idb>
- `inherits@2.0.4` — Copyright (c) Isaac Z. Schlueter — <https://github.com/isaacs/inherits>
- `isexe@2.0.0` — Copyright (c) Isaac Z. Schlueter and Contributors — <https://github.com/isaacs/isexe>
- `lru-cache@5.1.1` — Copyright (c) Isaac Z. Schlueter and Contributors — <https://github.com/isaacs/node-lru-cache>
- `lucide-react@0.562.0` — Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2023 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2025.* — <https://github.com/lucide-icons/lucide>
- `minimatch@5.1.9` — Copyright (c) 2011-2023 Isaac Z. Schlueter and Contributors — <https://github.com/isaacs/minimatch>
- `minipass@7.1.2` — Copyright (c) 2017-2023 npm, Inc., Isaac Z. Schlueter, and Contributors — <https://github.com/isaacs/minipass>
- `next-tick@1.1.0` — Copyright (c) 2012-2020, Mariusz Nowak, @medikoo, medikoo.com — <https://github.com/medikoo/next-tick>
- `picocolors@1.1.1` — Copyright (c) 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov — <https://github.com/alexeyraspopov/picocolors>
- `semver@6.3.1` — Copyright (c) Isaac Z. Schlueter and Contributors — <https://github.com/npm/node-semver>
- `signal-exit@4.1.0` — Copyright (c) 2015-2023 Benjamin Coe, Isaac Z. Schlueter, and Contributors — <https://github.com/tapjs/signal-exit>
- `type@2.7.3` — Copyright (c) 2019-2024, Mariusz Nowak, @medikoo, medikoo.com — <https://github.com/medikoo/type>
- `which@2.0.2` — Copyright (c) Isaac Z. Schlueter and Contributors — <https://github.com/isaacs/node-which>
- `y18n@5.0.8` — Copyright (c) 2015, Contributors — <https://github.com/yargs/y18n>
- `yallist@3.1.1` — Copyright (c) Isaac Z. Schlueter and Contributors — <https://github.com/isaacs/yallist>
- `yaml@2.9.0` — Copyright Eemeli Aro <eemeli@gmail.com> — <https://github.com/eemeli/yaml>
- `yargs-parser@21.1.1` — Copyright (c) 2016, Contributors — <https://github.com/yargs/yargs-parser>

### MIT (443)

- `@alloc/quick-lru@5.2.0` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) — <https://github.com/sindresorhus/quick-lru>
- `@apideck/better-ajv-errors@0.3.6` — Copyright (c) 2021 Apideck — <https://github.com/apideck-libraries/better-ajv-errors>
- `@babel/code-frame@7.29.7` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/compat-data@7.28.5` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/core@7.28.5` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/generator@7.29.7` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/helper-annotate-as-pure@7.27.3` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/helper-compilation-targets@7.27.2` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/helper-create-class-features-plugin@7.28.5` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/helper-create-regexp-features-plugin@7.28.5` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/helper-define-polyfill-provider@0.6.5` — Copyright (c) 2014-present Nicolò Ribaudo and other contributors — <https://github.com/babel/babel-polyfills>
- `@babel/helper-globals@7.29.7` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/helper-member-expression-to-functions@7.28.5` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/helper-module-imports@7.29.7` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/helper-module-transforms@7.29.7` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/helper-optimise-call-expression@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/helper-plugin-utils@7.29.7` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/helper-remap-async-to-generator@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/helper-replace-supers@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/helper-skip-transparent-expression-wrappers@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/helper-string-parser@7.29.7` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/helper-validator-identifier@7.29.7` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/helper-validator-option@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/helper-wrap-function@7.28.3` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/helpers@7.28.4` — Copyright (c) 2014-present Sebastian McKenzie and other contributors. Copyright (c) 2014-present, Facebook, Inc. (ONLY ./src/helpers/regenerator* files) — <https://github.com/babel/babel>
- `@babel/parser@7.29.7` — Copyright (C) 2012-2014 by various contributors (see AUTHORS) — <https://github.com/babel/babel>
- `@babel/plugin-bugfix-firefox-class-in-computed-class-key@7.28.5` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-bugfix-safari-class-field-initializer-scope@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-bugfix-safari-id-destructuring-collision-in-function-expression@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-bugfix-v8-spread-parameters-in-optional-chaining@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-bugfix-v8-static-class-fields-redefine-readonly@7.28.3` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-proposal-private-property-in-object@7.21.0-placeholder-for-preset-env.2` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel-plugin-proposal-private-property-in-object>
- `@babel/plugin-syntax-import-assertions@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-syntax-import-attributes@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-syntax-unicode-sets-regex@7.18.6` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-arrow-functions@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-async-generator-functions@7.28.0` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-async-to-generator@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-block-scoped-functions@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-block-scoping@7.28.5` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-class-properties@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-class-static-block@7.28.3` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-classes@7.28.4` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-computed-properties@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-destructuring@7.28.5` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-dotall-regex@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-duplicate-keys@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-duplicate-named-capturing-groups-regex@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-dynamic-import@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-explicit-resource-management@7.28.0` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-exponentiation-operator@7.28.5` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-export-namespace-from@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-for-of@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-function-name@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-json-strings@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-literals@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-logical-assignment-operators@7.28.5` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-member-expression-literals@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-modules-amd@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-modules-commonjs@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-modules-systemjs@7.29.7` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-modules-umd@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-named-capturing-groups-regex@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-new-target@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-nullish-coalescing-operator@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-numeric-separator@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-object-rest-spread@7.28.4` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-object-super@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-optional-catch-binding@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-optional-chaining@7.28.5` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-parameters@7.27.7` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-private-methods@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-private-property-in-object@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-property-literals@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-regenerator@7.28.4` — Copyright (c) 2014-present Sebastian McKenzie and other contributors. Copyright (c) 2014-present Facebook, Inc. — <https://github.com/babel/babel>
- `@babel/plugin-transform-regexp-modifiers@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-reserved-words@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-shorthand-properties@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-spread@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-sticky-regex@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-template-literals@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-typeof-symbol@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-unicode-escapes@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-unicode-property-regex@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-unicode-regex@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/plugin-transform-unicode-sets-regex@7.27.1` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/preset-env@7.28.5` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/preset-modules@0.1.6-no-external-plugins` — Copyright (c) 2020 Babel — <https://github.com/babel/preset-modules>
- `@babel/runtime@7.28.4` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/template@7.29.7` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/traverse@7.29.7` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@babel/types@7.29.7` — Copyright (c) 2014-present Sebastian McKenzie and other contributors — <https://github.com/babel/babel>
- `@capacitor-community/safe-area@7.0.0` — Copyright (c) 2022 Daniel Suchý — <https://github.com/capacitor-community/safe-area>
- `@capacitor-community/text-to-speech@6.1.0` — Copyright (c) 2021 Robin Genz — <https://github.com/capacitor-community/text-to-speech>
- `@capacitor/android@7.4.4` — Copyright (c) 2017-present Drifty Co. — <https://github.com/ionic-team/capacitor>
- `@capacitor/app@7.1.1` — Copyright 2020-present Ionic. https://ionic.io — <https://github.com/ionic-team/capacitor-plugins>
- `@capacitor/core@7.4.4` — Copyright (c) 2017-present Drifty Co. — <https://github.com/ionic-team/capacitor>
- `@capacitor/filesystem@7.1.6` — Copyright (c) 2025 Ionic — <https://github.com/ionic-team/capacitor-filesystem>
- `@capacitor/share@7.0.3` — Copyright 2020-present Ionic. https://ionic.io — <https://github.com/ionic-team/capacitor-plugins>
- `@capawesome-team/capacitor-android-battery-optimization@7.0.0` — Copyright (c) 2022 Robin Genz — <https://github.com/capawesome-team/capacitor-plugins>
- `@esbuild/darwin-x64@0.27.2` — <https://github.com/evanw/esbuild>
- `@floating-ui/core@1.7.3` — Copyright (c) 2021-present Floating UI contributors — <https://github.com/floating-ui/floating-ui>
- `@floating-ui/dom@1.7.4` — Copyright (c) 2021-present Floating UI contributors — <https://github.com/floating-ui/floating-ui>
- `@floating-ui/react-dom@2.1.6` — Copyright (c) 2021-present Floating UI contributors — <https://github.com/floating-ui/floating-ui>
- `@floating-ui/utils@0.2.10` — Copyright (c) 2021-present Floating UI contributors — <https://github.com/floating-ui/floating-ui>
- `@jridgewell/gen-mapping@0.3.13` — Copyright 2024 Justin Ridgewell <justin@ridgewell.name> — <https://github.com/jridgewell/sourcemaps>
- `@jridgewell/remapping@2.3.5` — Copyright 2024 Justin Ridgewell <justin@ridgewell.name> — <https://github.com/jridgewell/sourcemaps>
- `@jridgewell/resolve-uri@3.1.2` — Copyright 2019 Justin Ridgewell <jridgewell@google.com> — <https://github.com/jridgewell/resolve-uri>
- `@jridgewell/source-map@0.3.11` — Copyright 2024 Justin Ridgewell <justin@ridgewell.name> — <https://github.com/jridgewell/sourcemaps>
- `@jridgewell/sourcemap-codec@1.5.5` — Copyright 2024 Justin Ridgewell <justin@ridgewell.name> — <https://github.com/jridgewell/sourcemaps>
- `@jridgewell/trace-mapping@0.3.31` — Copyright 2024 Justin Ridgewell <justin@ridgewell.name> — <https://github.com/jridgewell/sourcemaps>
- `@radix-ui/number@1.1.1` — <https://github.com/radix-ui/primitives>
- `@radix-ui/primitive@1.1.3` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-arrow@1.1.7` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-checkbox@1.3.3` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-collection@1.1.7` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-compose-refs@1.1.2` — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-context@1.1.2` — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-dialog@1.1.15` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-direction@1.1.1` — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-dismissable-layer@1.1.11` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-dropdown-menu@2.1.16` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-focus-guards@1.1.3` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-focus-scope@1.1.7` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-id@1.1.1` — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-label@2.1.8` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-menu@2.1.16` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-popover@1.1.15` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-popper@1.2.8` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-portal@1.1.9` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-presence@1.1.5` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-primitive@2.1.3` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-primitive@2.1.4` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-roving-focus@1.1.11` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-scroll-area@1.2.10` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-select@2.2.6` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-slider@1.3.6` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-slot@1.2.3` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-slot@1.2.4` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-switch@1.2.6` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-tabs@1.1.13` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-use-callback-ref@1.1.1` — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-use-controllable-state@1.2.2` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-use-effect-event@0.0.2` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-use-escape-keydown@1.1.1` — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-use-layout-effect@1.1.1` — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-use-previous@1.1.1` — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-use-rect@1.1.1` — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-use-size@1.1.1` — <https://github.com/radix-ui/primitives>
- `@radix-ui/react-visually-hidden@1.2.3` — Copyright (c) 2022 WorkOS — <https://github.com/radix-ui/primitives>
- `@radix-ui/rect@1.1.1` — <https://github.com/radix-ui/primitives>
- `@rollup/plugin-babel@6.1.0` — Copyright (c) 2019 RollupJS Plugin Contributors (https://github.com/rollup/plugins/graphs/contributors) — <https://github.com/rollup/plugins>
- `@rollup/plugin-node-resolve@16.0.3` — Copyright (c) 2019 RollupJS Plugin Contributors (https://github.com/rollup/plugins/graphs/contributors) — <https://github.com/rollup/plugins>
- `@rollup/plugin-replace@6.0.3` — Copyright (c) 2019 RollupJS Plugin Contributors (https://github.com/rollup/plugins/graphs/contributors) — <https://github.com/rollup/plugins>
- `@rollup/plugin-terser@1.0.0` — Copyright (c) 2019 RollupJS Plugin Contributors (https://github.com/rollup/plugins/graphs/contributors) — <https://github.com/rollup/plugins>
- `@rollup/pluginutils@5.4.0` — Copyright (c) 2019 RollupJS Plugin Contributors (https://github.com/rollup/plugins/graphs/contributors) — <https://github.com/rollup/plugins>
- `@rollup/rollup-darwin-x64@4.61.1` — Copyright Lukas Taegert-Atkinson — <https://github.com/rollup/rollup>
- `@tailwindcss/node@4.1.18` — Copyright (c) Tailwind Labs, Inc. — <https://github.com/tailwindlabs/tailwindcss>
- `@tailwindcss/oxide-darwin-x64@4.1.18` — Copyright (c) Tailwind Labs, Inc. — <https://github.com/tailwindlabs/tailwindcss>
- `@tailwindcss/oxide@4.1.18` — Copyright (c) Tailwind Labs, Inc. — <https://github.com/tailwindlabs/tailwindcss>
- `@tailwindcss/postcss@4.1.18` — Copyright (c) Tailwind Labs, Inc. — <https://github.com/tailwindlabs/tailwindcss>
- `@types/babel__core@7.20.5` — <https://github.com/DefinitelyTyped/DefinitelyTyped>
- `@types/babel__generator@7.27.0` — <https://github.com/DefinitelyTyped/DefinitelyTyped>
- `@types/babel__template@7.4.4` — <https://github.com/DefinitelyTyped/DefinitelyTyped>
- `@types/babel__traverse@7.28.0` — <https://github.com/DefinitelyTyped/DefinitelyTyped>
- `@types/estree@1.0.9` — <https://github.com/DefinitelyTyped/DefinitelyTyped>
- `@types/localforage@0.0.34` — <https://github.com/localForage/localForage>
- `@types/node@25.0.3` — <https://github.com/DefinitelyTyped/DefinitelyTyped>
- `@types/react-dom@19.2.3` — <https://github.com/DefinitelyTyped/DefinitelyTyped>
- `@types/react@19.2.7` — <https://github.com/DefinitelyTyped/DefinitelyTyped>
- `@types/resolve@1.20.2` — <https://github.com/DefinitelyTyped/DefinitelyTyped>
- `@types/trusted-types@2.0.7` — <https://github.com/DefinitelyTyped/DefinitelyTyped>
- `@xmldom/xmldom@0.8.13` — Copyright 2019 - present Christopher J. Brody and other contributors, as listed in: https://github.com/xmldom/xmldom/graphs/contributors. Copyright 2012 - 2017 @jindw <jindw@xidea.org> and other contributors, as listed in: https://github.com/jindw/xmldom/graphs/contributors — <https://github.com/xmldom/xmldom>
- `@zumer/snapdom@2.0.1` — Copyright (c) 2025 ZumerLab — <https://github.com/zumerlab/snapdom>
- `acorn@8.16.0` — Copyright (C) 2012-2022 by various contributors (see AUTHORS) — <https://github.com/acornjs/acorn>
- `ajv@8.20.0` — Copyright (c) 2015-2021 Evgeny Poberezkin — <https://github.com/ajv-validator/ajv>
- `ansi-regex@5.0.1` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) — <https://github.com/chalk/ansi-regex>
- `ansi-regex@6.2.2` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) — <https://github.com/chalk/ansi-regex>
- `ansi-styles@4.3.0` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) — <https://github.com/chalk/ansi-styles>
- `ansi-styles@6.2.3` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) — <https://github.com/chalk/ansi-styles>
- `aria-hidden@1.2.6` — Copyright (c) 2017 Anton Korzunov — <https://github.com/theKashey/aria-hidden>
- `array-buffer-byte-length@1.0.2` — Copyright (c) 2023 Inspect JS — <https://github.com/inspect-js/array-buffer-byte-length>
- `arraybuffer.prototype.slice@1.0.4` — Copyright (c) 2023 ECMAScript Shims — <https://github.com/es-shims/ArrayBuffer.prototype.slice>
- `async-function@1.0.0` — Copyright (c) 2016 EduardoRFS — <https://github.com/ljharb/async-function>
- `async@3.2.6` — Copyright (c) 2010-2018 Caolan McMahon — <https://github.com/caolan/async>
- `available-typed-arrays@1.0.7` — Copyright (c) 2020 Inspect JS — <https://github.com/inspect-js/available-typed-arrays>
- `babel-plugin-polyfill-corejs2@0.4.14` — Copyright (c) 2014-present Nicolò Ribaudo and other contributors — <https://github.com/babel/babel-polyfills>
- `babel-plugin-polyfill-corejs3@0.13.0` — Copyright (c) 2014-present Nicolò Ribaudo and other contributors — <https://github.com/babel/babel-polyfills>
- `babel-plugin-polyfill-regenerator@0.6.5` — Copyright (c) 2014-present Nicolò Ribaudo and other contributors — <https://github.com/babel/babel-polyfills>
- `balanced-match@1.0.2` — Copyright (c) 2013 Julian Gruber &lt;julian@juliangruber.com&gt; — <https://github.com/juliangruber/balanced-match>
- `balanced-match@4.0.4` — <https://github.com/juliangruber/balanced-match>
- `brace-expansion@2.1.1` — Copyright (c) 2013 Julian Gruber <julian@juliangruber.com> — <https://github.com/juliangruber/brace-expansion>
- `brace-expansion@5.0.6` — Copyright Julian Gruber <julian@juliangruber.com> — <https://github.com/juliangruber/brace-expansion>
- `browser-image-compression@2.0.2` — Copyright (c) 2019 Donald Chan — <https://github.com/Donaldcwl/browser-image-compression>
- `browserslist@4.28.1` — Copyright 2014 Andrey Sitnik <andrey@sitnik.ru> and other contributors — <https://github.com/browserslist/browserslist>
- `buffer-from@1.1.2` — Copyright (c) 2016, 2018 Linus Unnebäck — <https://github.com/LinusU/buffer-from>
- `call-bind-apply-helpers@1.0.2` — Copyright (c) 2024 Jordan Harband — <https://github.com/ljharb/call-bind-apply-helpers>
- `call-bind@1.0.9` — Copyright (c) 2020 Jordan Harband — <https://github.com/ljharb/call-bind>
- `call-bound@1.0.4` — Copyright (c) 2024 Jordan Harband — <https://github.com/ljharb/call-bound>
- `clsx@2.1.1` — Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com) — <https://github.com/lukeed/clsx>
- `color-convert@2.0.1` — Copyright (c) 2011-2016 Heather Arthur <fayearthur@gmail.com> — <https://github.com/Qix-/color-convert>
- `color-name@1.1.4` — Copyright DY — <https://github.com/colorjs/color-name>
- `commander@2.20.3` — Copyright (c) 2011 TJ Holowaychuk <tj@vision-media.ca> — <https://github.com/tj/commander.js>
- `common-tags@1.8.2` — Copyright © Declan de Wet — <https://github.com/zspecza/common-tags>
- `convert-source-map@2.0.0` — Copyright 2013 Thorsten Lorenz. . All rights reserved. — <https://github.com/thlorenz/convert-source-map>
- `cookie@1.1.1` — Copyright (c) 2012-2014 Roman Shtylman <shtylman@gmail.com>. Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com> — <https://github.com/jshttp/cookie>
- `core-js-compat@3.47.0` — Copyright (c) 2014-2025 Denis Pushkarev, 2025 CoreJS Company — <https://github.com/zloirock/core-js>
- `core-js@3.47.0` — Copyright (c) 2014-2025 Denis Pushkarev, 2025 CoreJS Company — <https://github.com/zloirock/core-js>
- `core-util-is@1.0.3` — Copyright Node.js contributors. All rights reserved. — <https://github.com/isaacs/core-util-is>
- `cross-spawn@7.0.6` — Copyright (c) 2018 Made With MOXY Lda <hello@moxy.studio> — <https://github.com/moxystudio/node-cross-spawn>
- `crypto-random-string@2.0.0` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) — <https://github.com/sindresorhus/crypto-random-string>
- `csstype@3.2.3` — Copyright (c) 2017-2018 Fredrik Nicol — <https://github.com/frenic/csstype>
- `data-view-buffer@1.0.2` — Copyright (c) 2023 Jordan Harband — <https://github.com/inspect-js/data-view-buffer>
- `data-view-byte-length@1.0.2` — Copyright (c) 2024 Jordan Harband — <https://github.com/inspect-js/data-view-byte-length>
- `data-view-byte-offset@1.0.1` — Copyright (c) 2024 Jordan Harband — <https://github.com/inspect-js/data-view-byte-offset>
- `debug@4.4.3` — Copyright (c) 2014-2017 TJ Holowaychuk <tj@vision-media.ca>. Copyright (c) 2018-2021 Josh Junon — <https://github.com/debug-js/debug>
- `deepmerge@4.3.1` — Copyright (c) 2012 James Halliday, Josh Duff, and other contributors — <https://github.com/TehShrike/deepmerge>
- `define-data-property@1.1.4` — Copyright (c) 2023 Jordan Harband — <https://github.com/ljharb/define-data-property>
- `define-properties@1.2.1` — Copyright (C) 2015 Jordan Harband — <https://github.com/ljharb/define-properties>
- `detect-europe-js@0.1.2` — Copyright (c) 2024 Faisal Salman — <https://github.com/faisalman/detect-europe-js>
- `detect-node-es@1.1.0` — Copyright (c) 2017 Ilya Kantor — <https://github.com/thekashey/detect-node>
- `dunder-proto@1.0.1` — Copyright (c) 2024 ECMAScript Shims — <https://github.com/es-shims/dunder-proto>
- `eastasianwidth@0.2.0` — Copyright Masaki Komagata — <https://github.com/komagata/eastasianwidth>
- `emoji-regex@8.0.0` — Copyright Mathias Bynens <https://mathiasbynens.be/> — <https://github.com/mathiasbynens/emoji-regex>
- `emoji-regex@9.2.2` — Copyright Mathias Bynens <https://mathiasbynens.be/> — <https://github.com/mathiasbynens/emoji-regex>
- `enhanced-resolve@5.22.1` — Copyright JS Foundation and other contributors — <https://github.com/webpack/enhanced-resolve>
- `es-abstract@1.24.2` — Copyright (C) 2015 Jordan Harband — <https://github.com/ljharb/es-abstract>
- `es-define-property@1.0.1` — Copyright (c) 2024 Jordan Harband — <https://github.com/ljharb/es-define-property>
- `es-errors@1.3.0` — Copyright (c) 2024 Jordan Harband — <https://github.com/ljharb/es-errors>
- `es-object-atoms@1.1.2` — Copyright (c) 2024 Jordan Harband — <https://github.com/ljharb/es-object-atoms>
- `es-set-tostringtag@2.1.0` — Copyright (c) 2022 ECMAScript Shims — <https://github.com/es-shims/es-set-tostringtag>
- `es-to-primitive@1.3.0` — Copyright (c) 2015 Jordan Harband — <https://github.com/ljharb/es-to-primitive>
- `es6-iterator@2.0.3` — Copyright (C) 2013-2017 Mariusz Nowak (www.medikoo.com) — <https://github.com/medikoo/es6-iterator>
- `esbuild@0.27.2` — Copyright (c) 2020 Evan Wallace — <https://github.com/evanw/esbuild>
- `escalade@3.2.0` — Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com) — <https://github.com/lukeed/escalade>
- `estree-walker@2.0.2` — Copyright (c) 2015-20 [these people](https://github.com/Rich-Harris/estree-walker/graphs/contributors) — <https://github.com/Rich-Harris/estree-walker>
- `eta@4.6.0` — Copyright 2025 Ben Gubler <nebrelbug@gmail.com> — <https://github.com/bgub/eta>
- `event-emitter@0.3.5` — Copyright (C) 2012-2015 Mariusz Nowak (www.medikoo.com) — <https://github.com/medikoo/event-emitter>
- `fast-deep-equal@3.1.3` — Copyright (c) 2017 Evgeny Poberezkin — <https://github.com/epoberezkin/fast-deep-equal>
- `fast-json-stable-stringify@2.1.0` — Copyright (c) 2017 Evgeny Poberezkin. Copyright (c) 2013 James Halliday — <https://github.com/epoberezkin/fast-json-stable-stringify>
- `fdir@6.5.0` — Copyright 2023 Abdullah Atta — <https://github.com/thecodrr/fdir>
- `file-saver@2.0.5` — Copyright © 2016 [Eli Grey][1]. — <https://github.com/eligrey/FileSaver.js>
- `for-each@0.3.5` — Copyright (c) 2012 Raynos. — <https://github.com/Raynos/for-each>
- `fs-extra@9.1.0` — Copyright (c) 2011-2017 JP Richardson — <https://github.com/jprichardson/node-fs-extra>
- `fsevents@2.3.3` — Copyright (C) 2010-2020 by Philipp Dunkel, Ben Noordhuis, Elan Shankar, Paul Miller — <https://github.com/fsevents/fsevents>
- `function-bind@1.1.2` — Copyright (c) 2013 Raynos. — <https://github.com/Raynos/function-bind>
- `function.prototype.name@1.1.8` — Copyright (c) 2016 Jordan Harband — <https://github.com/es-shims/Function.prototype.name>
- `functions-have-names@1.2.3` — Copyright (c) 2019 Jordan Harband — <https://github.com/inspect-js/functions-have-names>
- `generator-function@2.0.1` — Copyright (c) 2015 Tiancheng “Timothy” Gu — <https://github.com/TimothyGu/generator-function>
- `gensync@1.0.0-beta.2` — Copyright 2018 Logan Smyth <loganfsmyth@gmail.com> — <https://github.com/loganfsmyth/gensync>
- `get-intrinsic@1.3.0` — Copyright (c) 2020 Jordan Harband — <https://github.com/ljharb/get-intrinsic>
- `get-nonce@1.0.1` — Copyright (c) 2020 Anton Korzunov — <https://github.com/theKashey/get-nonce>
- `get-proto@1.0.1` — Copyright (c) 2025 Jordan Harband — <https://github.com/ljharb/get-proto>
- `get-symbol-description@1.1.0` — Copyright (c) 2021 Inspect JS — <https://github.com/inspect-js/get-symbol-description>
- `globalthis@1.0.4` — Copyright (c) 2016 Jordan Harband — <https://github.com/ljharb/System.global>
- `gopd@1.2.0` — Copyright (c) 2022 Jordan Harband — <https://github.com/ljharb/gopd>
- `has-bigints@1.1.0` — Copyright (c) 2019 Jordan Harband — <https://github.com/ljharb/has-bigints>
- `has-property-descriptors@1.0.2` — Copyright (c) 2022 Inspect JS — <https://github.com/inspect-js/has-property-descriptors>
- `has-proto@1.2.0` — Copyright (c) 2022 Inspect JS — <https://github.com/inspect-js/has-proto>
- `has-symbols@1.1.0` — Copyright (c) 2016 Jordan Harband — <https://github.com/inspect-js/has-symbols>
- `has-tostringtag@1.0.2` — Copyright (c) 2021 Inspect JS — <https://github.com/inspect-js/has-tostringtag>
- `hasown@2.0.4` — Copyright (c) Jordan Harband and contributors — <https://github.com/inspect-js/hasOwn>
- `http-parser-js@0.5.10` — Copyright (c) 2015 Tim Caswell (https://github.com/creationix) and other. contributors. All rights reserved. — <https://github.com/creationix/http-parser-js>
- `immediate@3.0.6` — Copyright (c) 2012 Barnesandnoble.com, llc, Donavon West, Domenic Denicola, Brian Cavalier — <https://github.com/calvinmetcalf/immediate>
- `internal-slot@1.1.0` — Copyright (c) 2019 Jordan Harband — <https://github.com/ljharb/internal-slot>
- `is-array-buffer@3.0.5` — Copyright (c) 2015 Chen Gengyuan, Inspect JS — <https://github.com/inspect-js/is-array-buffer>
- `is-async-function@2.1.1` — Copyright (c) 2021 Jordan Harband — <https://github.com/inspect-js/is-async-function>
- `is-bigint@1.1.0` — Copyright (c) 2018 Jordan Harband — <https://github.com/inspect-js/is-bigint>
- `is-boolean-object@1.2.2` — Copyright (c) 2015 Jordan Harband — <https://github.com/inspect-js/is-boolean-object>
- `is-callable@1.2.7` — Copyright (c) 2015 Jordan Harband — <https://github.com/inspect-js/is-callable>
- `is-core-module@2.16.2` — Copyright (c) 2014 Dave Justice — <https://github.com/inspect-js/is-core-module>
- `is-data-view@1.0.2` — Copyright (c) 2024 Inspect JS — <https://github.com/inspect-js/is-data-view>
- `is-date-object@1.1.0` — Copyright (c) 2015 Jordan Harband — <https://github.com/inspect-js/is-date-object>
- `is-finalizationregistry@1.1.1` — Copyright (c) 2020 Inspect JS — <https://github.com/inspect-js/is-finalizationregistry>
- `is-fullwidth-code-point@3.0.0` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) — <https://github.com/sindresorhus/is-fullwidth-code-point>
- `is-generator-function@1.1.2` — Copyright (c) 2014 Jordan Harband — <https://github.com/inspect-js/is-generator-function>
- `is-map@2.0.3` — Copyright (c) 2019 Inspect JS — <https://github.com/inspect-js/is-map>
- `is-module@1.0.0` — Copyright (c) 2014 segmentio &lt;team@segment.io&gt; — <https://github.com/component/is-module>
- `is-negative-zero@2.0.3` — Copyright (c) 2014 Jordan Harband — <https://github.com/inspect-js/is-negative-zero>
- `is-number-object@1.1.1` — Copyright (c) 2015 Jordan Harband — <https://github.com/inspect-js/is-number-object>
- `is-obj@1.0.1` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) — <https://github.com/sindresorhus/is-obj>
- `is-regex@1.2.1` — Copyright (c) 2014 Jordan Harband — <https://github.com/inspect-js/is-regex>
- `is-regexp@1.0.0` — Copyright Sindre Sorhus — <https://github.com/sindresorhus/is-regexp>
- `is-set@2.0.3` — Copyright (c) 2019 Inspect JS — <https://github.com/inspect-js/is-set>
- `is-shared-array-buffer@1.0.4` — Copyright (c) 2021 Inspect JS — <https://github.com/inspect-js/is-shared-array-buffer>
- `is-standalone-pwa@0.1.1` — Copyright (c) 2024 Faisal Salman — <https://github.com/faisalman/is-standalone-pwa>
- `is-stream@2.0.1` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) — <https://github.com/sindresorhus/is-stream>
- `is-string@1.1.1` — Copyright (c) 2015 Jordan Harband — <https://github.com/inspect-js/is-string>
- `is-symbol@1.1.1` — Copyright (c) 2015 Jordan Harband — <https://github.com/inspect-js/is-symbol>
- `is-typed-array@1.1.15` — Copyright (c) 2015 Jordan Harband — <https://github.com/inspect-js/is-typed-array>
- `is-weakmap@2.0.2` — Copyright (c) 2019 Inspect JS — <https://github.com/inspect-js/is-weakmap>
- `is-weakref@1.1.1` — Copyright (c) 2020 Inspect JS — <https://github.com/inspect-js/is-weakref>
- `is-weakset@2.0.4` — Copyright (c) 2019 Inspect JS — <https://github.com/inspect-js/is-weakset>
- `isarray@1.0.0` — Copyright (c) 2013 Julian Gruber &lt;julian@juliangruber.com&gt; — <https://github.com/juliangruber/isarray>
- `isarray@2.0.5` — Copyright (c) 2013 Julian Gruber <julian@juliangruber.com> — <https://github.com/juliangruber/isarray>
- `isomorphic.js@0.2.5` — Copyright (c) 2020 Kevin Jahns <kevin.jahns@protonmail.com>. — <https://github.com/dmonad/isomorphic.js>
- `jiti@2.7.0` — Copyright (c) Pooya Parsa <pooya@pi0.io> — <https://github.com/unjs/jiti>
- `js-tokens@4.0.0` — Copyright (c) 2014, 2015, 2016, 2017, 2018 Simon Lydell — <https://github.com/lydell/js-tokens>
- `jsesc@3.1.0` — Copyright Mathias Bynens <https://mathiasbynens.be/> — <https://github.com/mathiasbynens/jsesc>
- `json-schema-traverse@1.0.0` — Copyright (c) 2017 Evgeny Poberezkin — <https://github.com/epoberezkin/json-schema-traverse>
- `json5@2.2.3` — Copyright (c) 2012-2018 Aseem Kishore, and [others]. — <https://github.com/json5/json5>
- `jsonfile@6.2.0` — Copyright (c) 2012-2015, JP Richardson <jprichardson@gmail.com> — <https://github.com/jprichardson/node-jsonfile>
- `jsonpointer@5.0.1` — Copyright (c) 2011-2015 Jan Lehnardt <jan@apache.org> & Marc Bachmann <https://github.com/marcbachmann> — <https://github.com/janl/node-jsonpointer>
- `leven@3.1.0` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) — <https://github.com/sindresorhus/leven>
- `lib0@0.2.117` — Copyright (c) 2019 Kevin Jahns <kevin.jahns@protonmail.com>. — <https://github.com/dmonad/lib0>
- `lie@3.1.1` — <https://github.com/calvinmetcalf/lie>
- `lie@3.3.0` — <https://github.com/calvinmetcalf/lie>
- `lodash.camelcase@4.3.0` — Copyright jQuery Foundation and other contributors <https://jquery.org/> — <https://github.com/lodash/lodash>
- `lodash.debounce@4.0.8` — Copyright jQuery Foundation and other contributors <https://jquery.org/> — <https://github.com/lodash/lodash>
- `lodash.sortby@4.7.0` — Copyright jQuery Foundation and other contributors <https://jquery.org/> — <https://github.com/lodash/lodash>
- `lodash.throttle@4.1.1` — Copyright jQuery Foundation and other contributors <https://jquery.org/> — <https://github.com/lodash/lodash>
- `lodash@4.18.1` — Copyright OpenJS Foundation and other contributors <https://openjsf.org/> — <https://github.com/lodash/lodash>
- `magic-string@0.30.21` — Copyright 2018 Rich Harris — <https://github.com/Rich-Harris/magic-string>
- `marks-pane@1.0.9` — Copyright Fred Chasen — <https://github.com/fchasen/marks>
- `math-intrinsics@1.1.0` — Copyright (c) 2024 ECMAScript Shims — <https://github.com/es-shims/math-intrinsics>
- `ms@2.1.3` — Copyright (c) 2020 Vercel, Inc. — <https://github.com/vercel/ms>
- `nanoid@3.3.12` — Copyright 2017 Andrey Sitnik <andrey@sitnik.ru> — <https://github.com/ai/nanoid>
- `node-releases@2.0.27` — Copyright (c) 2017 Sergey Rubanov (https://github.com/chicoxyzzy) — <https://github.com/chicoxyzzy/node-releases>
- `object-inspect@1.13.4` — Copyright (c) 2013 James Halliday — <https://github.com/inspect-js/object-inspect>
- `object-keys@1.1.1` — Copyright (C) 2013 Jordan Harband — <https://github.com/ljharb/object-keys>
- `object.assign@4.1.7` — Copyright (c) 2014 Jordan Harband — <https://github.com/ljharb/object.assign>
- `opencc-js@1.0.5` — Copyright (c) 2020-2021 The nk2028 Project — <https://github.com/nk2028/opencc-js>
- `own-keys@1.0.1` — Copyright (c) 2024 Jordan Harband — <https://github.com/ljharb/own-keys>
- `papaparse@5.5.3` — Copyright (c) 2015 Matthew Holt — <https://github.com/mholt/PapaParse>
- `path-key@3.1.1` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) — <https://github.com/sindresorhus/path-key>
- `path-parse@1.0.7` — Copyright (c) 2015 Javier Blanco — <https://github.com/jbgutierrez/path-parse>
- `path-webpack@0.0.3` — Copyright fchasen@gmail.com — <https://github.com/fchasen/path-webpack>
- `picomatch@4.0.4` — Copyright (c) 2017-present, Jon Schlinkert. — <https://github.com/micromatch/picomatch>
- `pinyin-pro@3.28.1` — Copyright (c) 2022-present zh-lx — <https://github.com/zh-lx/pinyin-pro>
- `possible-typed-array-names@1.1.0` — Copyright (c) 2024 Jordan Harband — <https://github.com/ljharb/possible-typed-array-names>
- `postcss@8.5.15` — Copyright 2013 Andrey Sitnik <andrey@sitnik.es> — <https://github.com/postcss/postcss>
- `pretty-bytes@5.6.0` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) — <https://github.com/sindresorhus/pretty-bytes>
- `pretty-bytes@6.1.1` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) — <https://github.com/sindresorhus/pretty-bytes>
- `process-nextick-args@2.0.1` — <https://github.com/calvinmetcalf/process-nextick-args>
- `punycode@2.3.1` — Copyright Mathias Bynens <https://mathiasbynens.be/> — <https://github.com/mathiasbynens/punycode.js>
- `react-dom@19.2.3` — Copyright (c) Meta Platforms, Inc. and affiliates. — <https://github.com/facebook/react>
- `react-lazy-load-image-component@1.6.3` — Copyright (c) 2018 Albert Juhé Lluveras — <https://github.com/Aljullu/react-lazy-load-image-component>
- `react-remove-scroll-bar@2.3.8` — Copyright Anton Korzunov — <https://github.com/theKashey/react-remove-scroll-bar>
- `react-remove-scroll@2.7.2` — Copyright (c) 2017 Anton Korzunov — <https://github.com/theKashey/react-remove-scroll>
- `react-router-dom@7.17.0` — Copyright (c) React Training LLC 2015-2019. Copyright (c) Remix Software Inc. 2020-2021. Copyright (c) Shopify Inc. 2022-2023 — <https://github.com/remix-run/react-router>
- `react-router@7.17.0` — Copyright (c) React Training LLC 2015-2019. Copyright (c) Remix Software Inc. 2020-2021. Copyright (c) Shopify Inc. 2022-2023 — <https://github.com/remix-run/react-router>
- `react-style-singleton@2.2.3` — Copyright (c) 2017 Anton Korzunov — <https://github.com/theKashey/react-style-singleton>
- `react@19.2.3` — Copyright (c) Meta Platforms, Inc. and affiliates. — <https://github.com/facebook/react>
- `readable-stream@2.3.8` — <https://github.com/nodejs/readable-stream>
- `reflect.getprototypeof@1.0.10` — Copyright (c) 2021 ECMAScript Shims — <https://github.com/es-shims/Reflect.getPrototypeOf>
- `regenerate-unicode-properties@10.2.2` — Copyright Mathias Bynens <https://mathiasbynens.be/> — <https://github.com/mathiasbynens/regenerate-unicode-properties>
- `regenerate@1.4.2` — Copyright Mathias Bynens <https://mathiasbynens.be/> — <https://github.com/mathiasbynens/regenerate>
- `regexp.prototype.flags@1.5.4` — Copyright (C) 2014 Jordan Harband — <https://github.com/es-shims/RegExp.prototype.flags>
- `regexpu-core@6.4.0` — Copyright Mathias Bynens <https://mathiasbynens.be/> — <https://github.com/mathiasbynens/regexpu-core>
- `regjsgen@0.8.0` — Copyright 2014-2020 Benjamin Tan <https://ofcr.se/> — <https://github.com/bnjmnt4n/regjsgen>
- `require-directory@2.1.1` — Copyright (c) 2011 Troy Goode <troygoode@gmail.com> — <https://github.com/troygoode/node-require-directory>
- `require-from-string@2.0.2` — Copyright (c) Vsevolod Strukchinsky <floatdrop@gmail.com> (github.com/floatdrop) — <https://github.com/floatdrop/require-from-string>
- `resolve@1.22.11` — Copyright (c) 2012 James Halliday — <https://github.com/browserify/resolve>
- `rollup@4.61.1` — Copyright (c) 2017 [these people](https://github.com/rollup/rollup/graphs/contributors) — <https://github.com/rollup/rollup>
- `safe-array-concat@1.1.4` — Copyright (c) 2023 Jordan Harband — <https://github.com/ljharb/safe-array-concat>
- `safe-buffer@5.1.2` — Copyright (c) Feross Aboukhadijeh — <https://github.com/feross/safe-buffer>
- `safe-push-apply@1.0.0` — Copyright (c) 2024 Jordan Harband — <https://github.com/ljharb/safe-push-apply>
- `safe-regex-test@1.1.0` — Copyright (c) 2022 Jordan Harband — <https://github.com/ljharb/safe-regex-test>
- `scheduler@0.27.0` — Copyright (c) Meta Platforms, Inc. and affiliates. — <https://github.com/facebook/react>
- `set-cookie-parser@2.7.2` — Copyright (c) 2015 Nathan Friedly <nathan@nfriedly.com> (http://nfriedly.com/) — <https://github.com/nfriedly/set-cookie-parser>
- `set-function-length@1.2.2` — Copyright (c) Jordan Harband and contributors — <https://github.com/ljharb/set-function-length>
- `set-function-name@2.0.2` — Copyright (c) Jordan Harband and contributors — <https://github.com/ljharb/set-function-name>
- `set-proto@1.0.0` — Copyright (c) 2024 Jordan Harband — <https://github.com/ljharb/set-proto>
- `setimmediate@1.0.5` — Copyright (c) 2012 Barnesandnoble.com, llc, Donavon West, and Domenic Denicola — <https://github.com/YuzuJS/setImmediate>
- `shebang-command@2.0.0` — Copyright (c) Kevin Mårtensson <kevinmartensson@gmail.com> (github.com/kevva) — <https://github.com/kevva/shebang-command>
- `shebang-regex@3.0.0` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) — <https://github.com/sindresorhus/shebang-regex>
- `side-channel-list@1.0.1` — Copyright (c) 2024 Jordan Harband — <https://github.com/ljharb/side-channel-list>
- `side-channel-map@1.0.1` — Copyright (c) 2024 Jordan Harband — <https://github.com/ljharb/side-channel-map>
- `side-channel-weakmap@1.0.2` — Copyright (c) 2019 Jordan Harband — <https://github.com/ljharb/side-channel-weakmap>
- `side-channel@1.1.0` — Copyright (c) 2019 Jordan Harband — <https://github.com/ljharb/side-channel>
- `smob@1.6.2` — Copyright (c) 2021-2022 Peter Placzek — <https://github.com/Tada5hi/smob>
- `source-map-support@0.5.21` — Copyright (c) 2014 Evan Wallace — <https://github.com/evanw/node-source-map-support>
- `stop-iteration-iterator@1.1.0` — Copyright (c) 2023 Jordan Harband — <https://github.com/ljharb/stop-iteration-iterator>
- `string_decoder@1.1.1` — <https://github.com/nodejs/string_decoder>
- `string-width@4.2.3` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) — <https://github.com/sindresorhus/string-width>
- `string-width@5.1.2` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) — <https://github.com/sindresorhus/string-width>
- `string.prototype.matchall@4.0.12` — Copyright (c) 2015 Jordan Harband — <https://github.com/es-shims/String.prototype.matchAll>
- `string.prototype.trim@1.2.11` — Copyright (c) 2015 Jordan Harband — <https://github.com/es-shims/String.prototype.trim>
- `string.prototype.trimend@1.0.10` — Copyright (c) 2017 Khaled Al-Ansari — <https://github.com/es-shims/String.prototype.trimEnd>
- `string.prototype.trimstart@1.0.8` — Copyright (c) 2017 Khaled Al-Ansari — <https://github.com/es-shims/String.prototype.trimStart>
- `strip-ansi@6.0.1` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) — <https://github.com/chalk/strip-ansi>
- `strip-ansi@7.1.2` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) — <https://github.com/chalk/strip-ansi>
- `strip-comments@2.0.1` — Copyright (c) 2014-present, Jon Schlinkert. — <https://github.com/jonschlinkert/strip-comments>
- `supports-preserve-symlinks-flag@1.0.0` — Copyright (c) 2022 Inspect JS — <https://github.com/inspect-js/node-supports-preserve-symlinks-flag>
- `tailwind-merge@3.4.0` — Copyright (c) 2021 Dany Castillo — <https://github.com/dcastil/tailwind-merge>
- `tailwindcss@4.1.18` — Copyright (c) Tailwind Labs, Inc. — <https://github.com/tailwindlabs/tailwindcss>
- `tapable@2.3.3` — Copyright JS Foundation and other contributors — <https://github.com/webpack/tapable>
- `temp-dir@2.0.0` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) — <https://github.com/sindresorhus/temp-dir>
- `tempy@0.6.0` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) — <https://github.com/sindresorhus/tempy>
- `tinyglobby@0.2.17` — Copyright (c) 2024 Madeline Gurriarán — <https://github.com/SuperchupuDev/tinyglobby>
- `tr46@1.0.1` — Copyright (c) 2016 Sebastian Mayr — <https://github.com/Sebmaster/tr46.js>
- `typed-array-buffer@1.0.3` — Copyright (c) 2023 Jordan Harband — <https://github.com/inspect-js/typed-array-buffer>
- `typed-array-byte-length@1.0.3` — Copyright (c) 2020 Inspect JS — <https://github.com/inspect-js/typed-array-byte-length>
- `typed-array-byte-offset@1.0.4` — Copyright (c) 2020 Inspect JS — <https://github.com/inspect-js/typed-array-byte-offset>
- `typed-array-length@1.0.8` — Copyright (c) 2020 Inspect JS — <https://github.com/inspect-js/typed-array-length>
- `ua-is-frozen@0.1.2` — Copyright (c) 2023 Faisal Salman — <https://github.com/faisalman/ua-is-frozen>
- `unbox-primitive@1.1.0` — Copyright (c) 2019 Jordan Harband — <https://github.com/ljharb/unbox-primitive>
- `undici-types@7.16.0` — Copyright (c) Matteo Collina and Undici contributors — <https://github.com/nodejs/undici>
- `unicode-canonical-property-names-ecmascript@2.0.1` — Copyright Mathias Bynens <https://mathiasbynens.be/> — <https://github.com/mathiasbynens/unicode-canonical-property-names-ecmascript>
- `unicode-match-property-ecmascript@2.0.0` — Copyright Mathias Bynens <https://mathiasbynens.be/> — <https://github.com/mathiasbynens/unicode-match-property-ecmascript>
- `unicode-match-property-value-ecmascript@2.2.1` — Copyright Mathias Bynens <https://mathiasbynens.be/> — <https://github.com/mathiasbynens/unicode-match-property-value-ecmascript>
- `unicode-property-aliases-ecmascript@2.2.0` — Copyright Mathias Bynens <https://mathiasbynens.be/> — <https://github.com/mathiasbynens/unicode-property-aliases-ecmascript>
- `unique-string@2.0.0` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) — <https://github.com/sindresorhus/unique-string>
- `universalify@2.0.1` — Copyright (c) 2017, Ryan Zimmerman <opensrc@ryanzim.com> — <https://github.com/RyanZim/universalify>
- `upath@1.2.0` — Copyright(c) 2014-2019 Angelos Pikoulas (agelos.pikoulas@gmail.com) — <https://github.com/anodynos/upath>
- `update-browserslist-db@1.2.3` — Copyright 2022 Andrey Sitnik <andrey@sitnik.ru> and other contributors — <https://github.com/browserslist/update-db>
- `use-callback-ref@1.3.3` — Copyright (c) 2017 Anton Korzunov — <https://github.com/theKashey/use-callback-ref>
- `use-sidecar@1.1.3` — Copyright (c) 2017 Anton Korzunov — <https://github.com/theKashey/use-sidecar>
- `util-deprecate@1.0.2` — Copyright (c) 2014 Nathan Rajlich <nathan@tootallnate.net> — <https://github.com/TooTallNate/util-deprecate>
- `uuid@13.0.2` — Copyright (c) 2010-2020 Robert Kieffer and other contributors — <https://github.com/uuidjs/uuid>
- `uzip@0.20201231.0` — Copyright (c) 2018 Photopea
- `vite-plugin-pwa@1.2.0` — Copyright (c) 2020-PRESENT Anthony Fu <https://github.com/antfu> — <https://github.com/vite-pwa/vite-plugin-pwa>
- `vite@7.3.5` — Copyright (c) 2019-present, VoidZero Inc. and Vite contributors — <https://github.com/vitejs/vite>
- `whatwg-url@7.1.0` — Copyright (c) 2015–2016 Sebastian Mayr — <https://github.com/jsdom/whatwg-url>
- `which-boxed-primitive@1.1.1` — Copyright (c) 2019 Jordan Harband — <https://github.com/inspect-js/which-boxed-primitive>
- `which-builtin-type@1.2.1` — Copyright (c) 2020 ECMAScript Shims — <https://github.com/inspect-js/which-builtin-type>
- `which-collection@1.0.2` — Copyright (c) 2019 Inspect JS — <https://github.com/inspect-js/which-collection>
- `which-typed-array@1.1.22` — Copyright (c) 2015 Jordan Harband — <https://github.com/inspect-js/which-typed-array>
- `workbox-background-sync@7.4.1` — Copyright 2018 Google LLC — <https://github.com/googlechrome/workbox>
- `workbox-broadcast-update@7.4.1` — Copyright 2018 Google LLC — <https://github.com/googlechrome/workbox>
- `workbox-build@7.4.1` — Copyright 2018 Google LLC — <https://github.com/googlechrome/workbox>
- `workbox-cacheable-response@7.4.1` — Copyright 2018 Google LLC — <https://github.com/googlechrome/workbox>
- `workbox-core@7.4.1` — Copyright 2018 Google LLC — <https://github.com/googlechrome/workbox>
- `workbox-expiration@7.4.1` — Copyright 2018 Google LLC — <https://github.com/googlechrome/workbox>
- `workbox-google-analytics@7.4.1` — Copyright 2018 Google LLC — <https://github.com/googlechrome/workbox>
- `workbox-navigation-preload@7.4.1` — Copyright 2018 Google LLC — <https://github.com/googlechrome/workbox>
- `workbox-precaching@7.4.1` — Copyright 2018 Google LLC — <https://github.com/googlechrome/workbox>
- `workbox-range-requests@7.4.1` — Copyright 2018 Google LLC — <https://github.com/googlechrome/workbox>
- `workbox-recipes@7.4.1` — Copyright 2018 Google LLC — <https://github.com/googlechrome/workbox>
- `workbox-routing@7.4.1` — Copyright 2018 Google LLC — <https://github.com/googlechrome/workbox>
- `workbox-strategies@7.4.1` — Copyright 2018 Google LLC — <https://github.com/googlechrome/workbox>
- `workbox-streams@7.4.1` — Copyright 2018 Google LLC — <https://github.com/googlechrome/workbox>
- `workbox-sw@7.4.1` — Copyright 2018 Google LLC — <https://github.com/googlechrome/workbox>
- `workbox-window@7.4.1` — Copyright 2018 Google LLC — <https://github.com/googlechrome/workbox>
- `wrap-ansi@7.0.0` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) — <https://github.com/chalk/wrap-ansi>
- `wrap-ansi@8.1.0` — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) — <https://github.com/chalk/wrap-ansi>
- `y-cinder@3.0.2606100319` — Copyright (c) 2024 Pod Raven — <https://github.com/vrwarp/y-cinder>
- `y-idb@9.1.0` — Copyright (c) 2014.   - Kevin Jahns <kevin.jahns@rwth-aachen.de>..   - Chair of Computer Science 5 (Databases & Information Systems), RWTH Aachen University, Germany — <https://github.com/vrwarp/y-idb>
- `y-protocols@1.0.7` — Copyright (c) 2019 Kevin Jahns <kevin.jahns@protonmail.com>. — <https://github.com/yjs/y-protocols>
- `yargs@17.7.2` — Copyright 2010 James Halliday (mail@substack.net); Modified work Copyright 2014 Contributors (ben@npmjs.com) — <https://github.com/yargs/yargs>
- `yjs@13.6.29` — Copyright (c) 2023.   - Kevin Jahns <kevin.jahns@protonmail.com>..   - Chair of Computer Science 5 (Databases & Information Systems), RWTH Aachen University, Germany — <https://github.com/yjs/yjs>
- `zod@4.3.5` — Copyright (c) 2025 Colin McDonnell — <https://github.com/colinhacks/zod>
- `zustand@5.0.9` — Copyright (c) 2019 Paul Henschel — <https://github.com/pmndrs/zustand>

### MPL-2.0 (3)

- `@capgo/capacitor-social-login@7.20.0` — Copyright Martin Donadieu — <https://github.com/Cap-go/capacitor-social-login>
- `lightningcss-darwin-x64@1.30.2` — <https://github.com/parcel-bundler/lightningcss>
- `lightningcss@1.30.2` — <https://github.com/parcel-bundler/lightningcss>
