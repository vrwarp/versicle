# Third-party licensing, provenance & notice inventory for vendored/forked assets

Subsystem key: `gap-third-party-licensing-provenan`
Repo: Versicle (`package.json:5` — `"license": "GPL-3.0-or-later"`; root `LICENSE` = GPL-3.0 full text, the only license file in the entire repo outside `node_modules`).

## What it is

Not a code subsystem but the legal/provenance layer that every distribution channel of Versicle depends on: the web bundle (`dist/`, served via nginx/GH Pages), the PWA precache, and the Capacitor Android APK all redistribute third-party code and data — fonts, a 14 MB dictionary, 18 MB of GPL WASM/data blobs, three personal forks of MIT libraries, a patched MPL-2.0 plugin, bundled EPUBs, audio assets, and ~45 npm runtime dependencies whose license banners the build strips. Two already-written target designs (platform-build, tts-providers/sync) mandate vendoring the forks and the patched Piper worker INTO this GPL repo, which converts today's "implicit, npm-resolved" license posture into "we are the distributor of record" — without a notice/provenance workstream, the overhaul *creates* legal debt while paying off technical debt.

Headline finding: there is **no license incompatibility anywhere** — GPL-3.0-or-later is compatible with every license found (MIT, BSD-2, ISC, Apache-2.0, MPL-2.0, GPL-3.0, AGPL-3.0, OFL, CC BY-SA 4.0). The debt is entirely in **notice retention, provenance recording, and one genuine OFL violation** (modified fonts keeping Reserved Font Names).

## File inventory

| File | Role |
|---|---|
| `LICENSE` | GPL-3.0 text; the only license file in the repo |
| `package.json:5` | `"license": "GPL-3.0-or-later"` declaration |
| `package.json:67,68,73` | Git deps on the three personal forks, **branch refs** (`#main`/`#master`) |
| `package-lock.json` | Pins forks to exact SHAs but via `git+ssh://git@github.com/...` URLs |
| `README.md:185-197` | "Licenses & Attributions" section — CC-CEDICT + PT Sans (the best compliance artifact in the repo) |
| `public/fonts/PT_Sans-Narrow-Web-{Regular,Bold}.ttf` (864 KB, git-tracked) | **Modified** OFL fonts retaining Reserved Font Names |
| `src/index.css:3-13,282` | `@font-face` declarations consuming the fonts as family "PT Sans Narrow" |
| `public/dict/cedict.json` (14.4 MB, git-tracked) | Compiled CC-CEDICT (CC BY-SA 4.0), no embedded provenance |
| `scripts/compile-dict.cjs` | Regeneration pipeline for cedict.json; strips the CC-CEDICT license header; silent mock fallback |
| `public/piper/piper_phonemize.{js,wasm,data}` + `piper_worker.js` (18.8 MB, **gitignored** `.gitignore:34`, ships in `dist/piper/`) | Emscripten build embedding GPL-3 espeak-ng data/code; copied from `piper-wasm` at postinstall (`package.json:14-15`) |
| `scripts/patch_piper_worker.js` | 6 string-replacement patches applied to the copied worker at install time |
| `node_modules/piper-wasm/` | Upstream `DavidCks/piper-wasm` 0.1.4, package claims MIT; bundles `espeak-ng/COPYING` = GPL-3 |
| `patches/@capgo+capacitor-social-login+7.20.0.patch` | patch-package diff against **MPL-2.0** code (login_hint support) |
| `node_modules/{y-cinder,y-idb,zustand-middleware-yjs}` | The three MIT forks; each retains upstream LICENSE + fork-provenance README |
| `src/data/bible-lexicon.ts` (2,899 lines) | Bible abbreviation/lexicon data; line 73 cites a `lexicon-bible.csv` that does not exist in the repo |
| `src/assets/{silence.ogg,10s_8k_sub_bass_vbr_off.webm}` | Background-audio media, provenance unrecorded (`src/assets/README.md` documents neither) |
| `public/logo_drive_2020q4_color_2x_web_64dp.png` | Google Drive trademark asset (used `src/components/settings/SyncSettingsTab.tsx:490`) |
| `public/alice.epub`, `public/books/alice.epub` (duplicate, 188,876 B each) | Project Gutenberg #11 demo book (public domain, PG trademark text embedded) |
| `src/components/settings/GeneralSettingsTab.tsx:100-202` | In-app "Credits & Licenses" UI (CC-CEDICT, Piper, opencc-js, epub.js) — two wrong upstream links |
| `src/components/reader/VisualSettings.tsx:144-171` | Second, hand-duplicated CC-CEDICT attribution block |
| `dist/` | Built output: ships fonts, dict, piper blobs, both EPUBs, Drive logo; **zero** license comments survive in any JS chunk |

## How it works (data & control flow)

1. **npm install** → `postinstall` (`package.json:15`) runs `patch-package` (applies the MPL patch to `node_modules/@capgo/...dist/esm/google-provider.js`) then `prepare-piper` (`package.json:14`): copies four artifacts from `node_modules/piper-wasm/build/` into gitignored `public/piper/`, then `scripts/patch_piper_worker.js` string-patches the worker (warns-and-continues on 5 of 6 anchor mismatches).
2. **Build** → Vite copies `public/` verbatim into `dist/` (fonts, dict, piper, EPUBs, Drive logo) and bundles ~45 runtime deps; esbuild minification strips all `@license`/banner comments (verified: `grep -l "@license" dist/assets/*.js` → 0 of 20 files).
3. **Runtime** → app additionally fetches third-party payloads not in the repo at all: Piper voice models from `https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/` (`src/lib/tts/providers/PiperProvider.ts:7`) and onnxruntime-web 1.17.1 from cdnjs (`src/lib/tts/providers/piper-utils.ts:281`).
4. **Attribution surfaces** → `README.md:185-197` (CC-CEDICT + fonts) and two hand-written JSX blocks (`GeneralSettingsTab.tsx:100-202`, `VisualSettings.tsx:144-171`). Nothing covers the forks, espeak-ng, firebase/Apache NOTICE, the AGPL dependency, or the other ~40 bundled packages; nothing ships in `dist/`.

### Full license census of runtime dependencies (from package-lock)

- **MIT** (44 incl. the three forks, piper-wasm, react, yjs, zustand, opencc-js, pinyin-pro…)
- **Apache-2.0**: `@google/generative-ai`, `class-variance-authority`, `comlink`, `firebase`
- **BSD-2-Clause**: `epubjs` · **ISC**: `idb`, `lucide-react`
- **MPL-2.0**: `@capgo/capacitor-social-login` (the patched one — the task brief's "MIT" assumption is wrong; verified `node_modules/@capgo/capacitor-social-login/LICENSE` + package.json)
- **GPL-3.0-or-later**: `@jofr/capacitor-media-session`
- **AGPL-3.0-or-later**: `ua-parser-js` ^2.0.8 (v2 relicensed from MIT; used in exactly one place, `src/store/useDeviceStore.ts:3,56`, for device display names)
- **(MIT OR GPL-3.0-or-later)**: `jszip` · **(MPL-2.0 OR Apache-2.0)**: `dompurify`

All compatible with GPL-3.0-or-later distribution. The AGPL and GPL entries are the reason the repo's own GPL choice is not merely stylistic — it is effectively **mandatory** given `@jofr/capacitor-media-session`, and worth recording so a future relicensing attempt doesn't silently violate.

## Technical debt

### D1. No THIRD-PARTY-NOTICES anywhere, and the build strips every license banner
- **Severity**: high · **Category**: hygiene
- **Evidence**: `find . -iname "*notice*" -o -iname "*license*"` (excl. node_modules/.git) → only `./LICENSE`. `grep -l "@license" dist/assets/*.js` → 0 of 20 chunks (React's `/** @license React */`, firebase Apache headers etc. all stripped; `vite.config.ts` sets no `esbuild.legalComments`). `dist/` and the Android APK therefore redistribute MIT/BSD/ISC/Apache code with no copyright notice or license text anywhere in the artifact, unmet conditions of essentially every permissive license in the census above (MIT: "shall be included in all copies"; BSD-2 §2: binary redistribution must reproduce notice "in the documentation and/or other materials"; Apache-2.0 §4d NOTICE). The in-app credits UI covers 4 of ~45 packages.
- **Impact**: every distributed build is formally non-compliant with its permissive-licensed inputs; the gap silently extends to the Android/Play channel; any fork/vendor step in the overhaul inherits and amplifies it.
- **Fix**: add a generated `THIRD-PARTY-NOTICES.md` (machine-readable `third-party.json` companion) produced from package-lock at build time (e.g., rollup-plugin-license or a ~100-line script), emitted into `dist/`; link it from the in-app credits and README; CI check that fails on UNKNOWN/disallowed licenses and on inventory drift.

### D2. Modified PT Sans fonts violate OFL 1.1 Reserved Font Name clause; modification tooling not in repo
- **Severity**: high · **Category**: correctness (license violation in shipped artifact)
- **Evidence**: `README.md:192-196` states pinyin tone glyphs (ǎ ǐ ǒ ǔ ǚ) were "programmatically injected … into the local TrueType font binaries … using Python fonttools" — i.e., these are **Modified Versions** under OFL. Embedded name table (verified via `strings public/fonts/PT_Sans-Narrow-Web-Regular.ttf`): family "PT Sans Narrow", version "2.003W", copyright "(c) 2010 ParaType Ltd … with Reserved Font Names 'PT Sans', 'PT Serif' and 'ParaType'", full OFL 1.1 text embedded. OFL 1.1 condition 3: "No Modified Version of the Font Software may use the Reserved Font Name(s) unless explicit written permission is granted." Both filenames (`PT_Sans-Narrow-Web-*.ttf`) and the `font-family: 'PT Sans Narrow'` in `src/index.css:3-13` use the RFN. The fonttools script that produced the binaries exists nowhere in the repo (`scripts/` contains no font tooling; `scripts/README.md` describes only a nonexistent `generate_pwa_icons.py`), so the derivative is unreproducible. Git history (`a8ca4e82 "chore: update PT Sans Narrow web font files"`) confirms in-repo binary replacement with no recorded process. Mitigating: the OFL text + copyright ride inside the TTF name table, so license text technically accompanies copies.
- **Impact**: an actual license violation (not just a missing notice) in every web and Android distribution; unreproducible binary assets contradict the repo's local-first/auditable ethos.
- **Fix**: rename the modified family per OFL FAQ (e.g., "Versicle Sans Narrow") in name IDs 1/4/6/16, filenames, and `src/index.css`; check the fonttools patch script into `scripts/`; add `public/fonts/OFL.txt` with the ParaType copyright line; inventory entry with upstream URL + version 2.003W + modification description (README already has the right prose — keep it, correct it).

### D3. GPL-3 espeak-ng blobs shipped with zero provenance; vendoring plans will check them in as-is
- **Severity**: high · **Category**: hygiene (GPL §6 corresponding-source exposure)
- **Evidence**: `public/piper/piper_phonemize.data` (18 MB) is an Emscripten FS pack of `espeak-ng-data` (loader manifest in `piper_phonemize.js` lists `espeak-ng-data/af_dict…`; `strings` on the .data shows espeak voice files). espeak-ng is GPL-3.0: `node_modules/piper-wasm/espeak-ng/COPYING` = GPL v3. `piper_phonemize.wasm` compiles piper-phonemize **linked against espeak-ng**, so the binary is GPL-governed regardless of piper-wasm's blanket `"license": "MIT"` claim (`node_modules/piper-wasm/package.json`) — upstream's own metadata is unreliable. Build provenance chain: `DavidCks/piper-wasm` README says binaries "were generated using the steps proposed by wide-video/piper-wasm"; the exact espeak-ng/piper-phonemize commits are recorded nowhere. Versicle distributes these blobs in `dist/piper/` today and the overhaul targets (`plan/overhaul/analysis/platform-build.md:120,190`; `tts-providers.md:154,216`) mandate checking the patched artifacts into this repo, making Versicle the distributor of a GPL object-code work whose Corresponding Source (GPLv3 §6) it cannot identify.
- **Impact**: GPL distribution obligation that is currently impossible to satisfy; gets crystallized (and attributed to this repo) the moment vendoring lands; also blocks any future security rebuild of the WASM.
- **Fix**: when vendoring, add `public/piper/PROVENANCE.md` (or `src/vendor/piper/`) recording: piper-wasm 0.1.4 (npm, MIT wrapper), upstream build recipe URL, espeak-ng version + GPL-3.0 notice, piper-phonemize (MIT) version, list of local patches (`scripts/patch_piper_worker.js`'s 6 patches); add espeak-ng + piper-phonemize entries to THIRD-PARTY-NOTICES; long-term, rebuild the WASM from pinned upstream commits in CI so corresponding source is actually offerable.

### D4. In-app credits cite wrong upstreams and a wrong license claim
- **Severity**: medium · **Category**: correctness
- **Evidence**: `src/components/settings/GeneralSettingsTab.tsx:157` links "piper-wasm" to `https://github.com/thewh1teagle/piper-wasm` — the installed package is `DavidCks/piper-wasm` (`node_modules/piper-wasm/package.json` repository field). `:173` links opencc-js to `https://github.com/skishore/opencc-js` — actual upstream is `nk2028/opencc-js` (verified package.json). `:145-165` describes the Piper WASM stack as "(MIT License)" with no mention of GPL espeak-ng inside the shipped blobs (see D3). The CC-CEDICT attribution block is hand-duplicated in `VisualSettings.tsx:144-171` with different wording.
- **Impact**: the one user-facing compliance surface misattributes two projects and understates a copyleft component; duplicated JSX drifts independently.
- **Fix**: drive both UI surfaces from the generated `third-party.json` (D1) — a single `<Credits/>` component rendering name/version/license/URL; delete the hand-written blocks.

### D5. cedict.json: license header discarded, no version stamp, and a silent fake-dictionary fallback
- **Severity**: medium · **Category**: hygiene (plus a correctness landmine)
- **Evidence**: `scripts/compile-dict.cjs:92` skips every `#` line — the CC-CEDICT header that contains the license declaration, release date, and entry count is thrown away; output is a bare JSON object (verified: file begins directly with `{"11区":…`), so the committed 14.4 MB `public/dict/cedict.json` has no machine-readable provenance and its source release date is unknowable. `compile-dict.cjs:48-62`: on download failure it **writes an 11-entry mock dictionary to the same output path** and exits successfully — a regeneration on a flaky network would silently replace the real dictionary in git. CC BY-SA 4.0 attribution itself is satisfied (README + 2 UI surfaces) and ShareAlike is explicitly handled (`README.md:190`).
- **Impact**: cannot prove which CC-CEDICT release is shipped (CC BY-SA asks modifications/source to be indicated); the mock fallback can corrupt the dataset unnoticed.
- **Fix**: emit a `__meta` key or sidecar `cedict.meta.json` ({source URL, license, release date from the header, entry count, compiler version}); delete the mock fallback (fail hard); surface the release date in the credits UI.

### D6. MPL-2.0 patch applied with no license note and no upstreaming record
- **Severity**: medium · **Category**: hygiene
- **Evidence**: `patches/@capgo+capacitor-social-login+7.20.0.patch` modifies `dist/esm/google-provider.js` of an **MPL-2.0** package (LICENSE verified; the assignment brief's "MIT" is incorrect). MPL-2.0 §3.1-3.2: modified Covered Software must remain MPL and Executable-Form recipients must be told how to obtain Source Form. The patch (login_hint plumbing) is itself publicly in the repo — de facto source availability — but no file records that this is MPL-covered, no `patches/README.md` exists, and the change has no upstream PR reference despite being generically useful.
- **Impact**: low legal risk today (public GPL repo), but the obligation is invisible — a future closed distribution or patch-file removal breaks compliance silently.
- **Fix**: `patches/README.md` documenting each patch (upstream version, license, why, upstream-PR link); MPL-2.0 entry in THIRD-PARTY-NOTICES pointing at the patch; submit login_hint upstream to capgo.

### D7. Copyleft escalation in the dependency tree is unrecorded (AGPL ua-parser-js v2, GPL media-session)
- **Severity**: medium · **Category**: architecture
- **Evidence**: `ua-parser-js: ^2.0.8` (`package.json:64`) — v2 relicensed to **AGPL-3.0-or-later** (package-lock license field), used in one file for device display names (`src/store/useDeviceStore.ts:3,56`); paired `@types/ua-parser-js: ^0.7.39` (`package.json:90`) targets the MIT-era 0.7 API — version/type skew and v2 ships its own types. `@jofr/capacitor-media-session: ^4.0.0` (`package.json:28`) is GPL-3.0-or-later — this alone makes GPL-3 the *only* viable license for the combined work, which nothing documents. `jszip` is dual (MIT OR GPL-3.0-or-later).
- **Impact**: all compatible today, but the constraints are invisible: a future relicensing, dual-licensing, or app-store-policy change would trip over them; AGPL adds network-source obligations attached to one trivially-replaceable utility.
- **Fix**: record the copyleft graph in the inventory with an explicit "license floor: GPL-3.0-or-later because of X" note; replace ua-parser-js v2 with a ~20-line UA sniff (one call site) or pin v1.x (MIT) — and delete the stale `@types` package either way; add the CI license allowlist (D1) so the next relicensed dependency is caught at PR time.

### D8. Fork dependencies: branch refs, git+ssh resolution, and no vendoring license checklist in the plans that mandate vendoring
- **Severity**: medium · **Category**: architecture
- **Evidence**: `package.json:67,68,73` — `github:vrwarp/y-cinder#main`, `y-idb#master`, `zustand-middleware-yjs#master` (branch refs). package-lock resolves them to exact SHAs but via `git+ssh://git@github.com/...`, so a fresh `npm ci` requires GitHub SSH credentials (containers/CI without a key fail). The forks themselves are clean MIT citizens: each retains the upstream LICENSE with the original holder (y-cinder: "Pod Raven 2024" from y-fire; y-idb: Kevin Jahns/RWTH Aachen from y-indexeddb; zustand-middleware-yjs: Joseph R Miles) and each README declares fork provenance. But `platform-build.md:190,201` (workspace-vendor all three with history) and `sync.md:168-172` (pin + contract-test) say nothing about carrying LICENSE files, upstream attribution, or a modifications summary into `packages/*`.
- **Impact**: reproducibility/CI friction now; after vendoring, MIT notice-retention failure is one careless `git subtree`/copy away, and "which commit did we diverge from upstream?" becomes unanswerable.
- **Fix**: vendoring checklist appended to the platform-build workstream: per-package LICENSE retained verbatim, README header "Fork of <upstream>@<commit>, modifications: …", inventory entries, and replace git+ssh deps with `file:packages/*` (or at minimum `git+https`) in the same PR.

### D9. Unrecorded provenance for small in-repo assets (bible lexicon, audio, Google logo, stale asset READMEs)
- **Severity**: low · **Category**: hygiene
- **Evidence**: `src/data/bible-lexicon.ts:73` — "Based on lexicon-bible.csv"; no such CSV exists anywhere in the repo (2,899 lines of data with an orphaned citation; content is factual abbreviation data, so copyright risk is minimal but the reference is dead). `src/assets/10s_8k_sub_bass_vbr_off.webm` (13.7 KB white-noise loop) and `silence.ogg` have no recorded source; `src/assets/README.md` documents only `react.svg` — which is itself unused (zero imports) template residue. `public/logo_drive_2020q4_color_2x_web_64dp.png` is a Google Drive trademark asset (used at `SyncSettingsTab.tsx:490`) with no brand-guideline note. `public/README.md` references a nonexistent `vite.svg` and omits `dict/`, `fonts/`, `piper/`, the root-level duplicate `public/alice.epub` (byte-identical to `public/books/alice.epub`, 188,876 B each — both ship in dist). `scripts/README.md` documents only a deleted Python script.
- **Impact**: archaeology cost for every future maintainer; the duplicate EPUB wastes 189 KB in every build; trademark usage is undocumented.
- **Fix**: one-line provenance headers (bible-lexicon: either commit the CSV or rewrite the comment as "hand-assembled"); record audio asset origin or regenerate with a documented command (ffmpeg one-liner); note Google brand-guidelines usage; deduplicate alice.epub; refresh the three stale READMEs as part of the platform-build docs pass.

### D10. Runtime-fetched third-party payloads (Piper voices, onnxruntime CDN) outside any license policy
- **Severity**: low · **Category**: hygiene
- **Evidence**: voice models are fetched per-user from `https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/` (`PiperProvider.ts:7`); individual Piper voices carry heterogeneous dataset licenses (several upstream MODEL_CARDs are non-commercial or attribution-bearing) and the app surfaces none of it in the voice picker. onnxruntime-web 1.17.1 loads from cdnjs at runtime (`piper-utils.ts:281`) — MIT, fine, but `tts-providers.md:97,216` plans to vendor it into `public/piper/`, adding it to the notices burden.
- **Impact**: user-initiated download ≠ Versicle redistribution, so legal exposure is minimal — but a privacy-centric reader showing zero license info for downloaded models is a product gap, and the planned onnxruntime vendoring needs an inventory entry on day one.
- **Fix**: show per-voice license (from the HF MODEL_CARD data already adjacent to voices.json) in the Piper voice picker; add onnxruntime-web to THIRD-PARTY-NOTICES when vendored.

## Problematic couplings

- **platform-build target design** (`plan/overhaul/analysis/platform-build.md:190,201`) mandates workspace-vendoring `y-cinder`/`y-idb`/`zustand-middleware-yjs` and checking in the patched piper worker — with no license/notice step. This workstream must gate those PRs (D3, D8).
- **tts-providers target design** (`plan/overhaul/analysis/tts-providers.md:97,154,216`) mandates vendoring onnxruntime-web + the four piper artifacts into the repo — same gate (D3, D10).
- **sync target design** (`plan/overhaul/analysis/sync.md:168-172`) pins/contract-tests the forks; the pinning PR is the natural place for the fork provenance headers (D8).
- **Attribution UI duplicated across subsystems**: `GeneralSettingsTab.tsx:100-202` (settings) and `VisualSettings.tsx:144-171` (reader) hand-maintain divergent CC-CEDICT blocks; neither is generated (D4).
- **Build tooling owns provenance-bearing artifacts**: `scripts/compile-dict.cjs` (writes `public/dict`), `scripts/patch_piper_worker.js` + `package.json:14-15` postinstall (writes `public/piper`) — any change to these scripts silently changes what is distributed; the notices generator must run after them.

## What's good (keep)

- **`README.md:185-197` "Licenses & Attributions"** — accurate CC BY-SA 4.0 ShareAlike statement for the compiled dictionary and an honest, detailed disclosure of the font modifications. The prose is right; only the RFN consequence was missed.
- **In-app CC-CEDICT attribution** (two surfaces) genuinely satisfies CC BY-SA 4.0 attribution + "indicate changes" — rare diligence; keep the behavior, generate the content.
- **The three forks are model citizens**: upstream LICENSE files retained verbatim with original copyright holders; READMEs declare "fork of y-fire / y-indexeddb / …". Vendoring must preserve exactly this.
- **`compile-dict.cjs` records its source URL** (`:6`, mdbg.net export) — the regeneration path is documented even if the output isn't stamped.
- **GPL-3.0-or-later as the app license is the correct (and only viable) choice** given `@jofr/capacitor-media-session` (GPL-3) and espeak-ng (GPL-3) in the shipped artifact — do not "simplify" to MIT/Apache during the overhaul; it would be a violation, not a cleanup.
- **Lockfile pins the fork SHAs** (exact commits recorded) — keep until vendoring lands.
- **`public/README.md` / `src/assets/README.md` exist at all** — the per-directory README convention is good; the content is stale (D9), the pattern is right.

## Target design

One source of truth, everything else generated:

1. **`third-party/inventory.json`** (checked in, schema-validated in CI): every redistributed third-party artifact — npm bundle deps (auto-extracted from package-lock), vendored packages, `public/` data assets (fonts, dict, piper blobs, EPUBs, Drive logo, audio), and runtime-fetched payloads — each with: name, version, upstream URL, license SPDX, license-text path, provenance (how obtained/built), local modifications, distribution channels (web/android/runtime).
2. **Generated outputs** from the inventory at build time:
   - `dist/THIRD-PARTY-NOTICES.txt` (license texts + copyright lines; satisfies MIT/BSD/ISC/Apache notice retention — compensates for stripped banners),
   - in-app `<Credits/>` component data (replaces both hand-written JSX blocks),
   - `THIRD-PARTY-NOTICES.md` at repo root for the GitHub audience.
3. **CI license gate**: license-checker against an allowlist (`MIT, BSD-*, ISC, Apache-2.0, MPL-2.0, OFL-1.1, GPL-3.0*, AGPL-3.0* (flagged), CC-BY-SA-4.0`); fails on UNKNOWN or new copyleft without an inventory entry; fails if `dist/THIRD-PARTY-NOTICES.txt` is missing or stale.
4. **Per-vendored-directory provenance files**: `packages/{y-cinder,y-idb,zustand-middleware-yjs}/LICENSE` (retained) + fork header; `public/piper/PROVENANCE.md` (espeak-ng GPL-3 + piper-phonemize + build recipe + local patch list); `public/fonts/OFL.txt`; `public/dict/cedict.meta.json`.
5. **Fixed artifacts**: fonts renamed off the Reserved Font Names with the fonttools script committed; cedict compiler stamps metadata and fails hard; `patches/README.md`; ua-parser-js replaced or consciously recorded; stale asset READMEs rewritten.
6. **License floor documented**: a short `LICENSING.md` stating the combined work is GPL-3.0-or-later and *why* (GPL/AGPL inputs enumerated), so no future "relicense to MIT" PR can pass review accidentally.

## Migration notes

No user data is involved anywhere in this subsystem; every step is repo/build-side and independently shippable.

1. **Order matters relative to other workstreams**: land the inventory + notices generator (steps 1-3) **before** the platform-build fork-vendoring PR and the tts-providers piper-vendoring PR, so those PRs are gated by the CI license check and ship with provenance files from day one. If sequencing slips, at minimum the vendoring PRs must carry the per-directory LICENSE/PROVENANCE files (D3/D8 fixes) inline.
2. **Font rename is the only user-visible change**: renaming the family off "PT Sans Narrow" requires updating `src/index.css:3-13,282` and any persisted font-preference values that store the family string — grep persisted preference stores for `'PT Sans Narrow'` and add a one-line rename mapping in the preferences migration if the string is stored (reader font profiles). Ship rename + CSS + migration atomically; visual output is identical (same glyphs).
3. **cedict.json regeneration**: stamping `__meta` changes the file hash (14 MB re-download for PWA users on next update) — fold it into a release that already touches the dict; verify `useChineseDictionary.ts` ignores unknown keys (it indexes by character key, so a `__meta` key must be filtered from lookup — trivial guard) or use the sidecar-file option to avoid touching the payload at all.
4. **Mock-fallback removal** in `compile-dict.cjs` is safe immediately (the script is manual/dev-time only).
5. **patches/ note + capgo upstream PR** are zero-risk; if upstream merges login_hint, drop the patch and the patch-package step for it.
6. **ua-parser-js replacement** touches only `useDeviceStore.ts:56`; device names are cosmetic synced data — existing names persist, new devices get names from the new sniffer; no migration.
7. **Notices in dist** adds one static file to the SW precache manifest — verify it stays out of the navigation fallback and counts ~30-60 KB against the (already raised) precache budget.
8. **Keep the GPL license header status quo**: do not add SPDX headers to vendored MIT files claiming GPL; vendored packages keep their MIT LICENSE, the combined work statement lives in LICENSING.md.
