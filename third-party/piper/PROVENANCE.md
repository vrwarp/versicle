# third-party/piper — provenance

Vendored at Phase 5a-PR3 (plan/overhaul/prep/phase5-tts-strangler.md §5a.2). This
directory is the COMMITTED source of the Piper TTS runtime assets, served verbatim at
the same runtime URL layout as before (`/piper/**`, copied to `dist/piper/` at build by
the inline `vite.config.ts` plugin). It replaces the install-time pipeline that copied
these files from `node_modules/piper-wasm` into a gitignored `public/piper/` and
string-patched the worker on every `npm ci` (`prepare-piper` postinstall +
`scripts/patch_piper_worker.js`, both deleted in the vendoring commit — the Phase 1
deletion-audit veto on that script, prep/phase1-deletions.md §1.18, is closed by this
replacement).

## Contents and upstream origin

| File | Origin | Disposition |
|---|---|---|
| `piper_phonemize.js` | `piper-wasm@0.1.4` npm package, `build/piper_phonemize.js` (DavidCks/piper-wasm) | verbatim |
| `piper_phonemize.wasm` | same package, `build/piper_phonemize.wasm` | verbatim (GPL-3-governed — embeds espeak-ng; see Licensing) |
| `piper_phonemize.data` | same package, `build/piper_phonemize.data` (Emscripten FS image of espeak-ng-data) | verbatim (GPL-3-governed) |
| `piper_worker.js` | same package, `build/worker/piper_worker.js` | **PATCHED SOURCE** (see Patch list) |
| `onnxruntime/ort.min.js`, `onnxruntime/ort-wasm{,-simd,-threaded,-simd-threaded}.wasm` | `onnxruntime-web@1.17.1` npm tarball, `dist/` (microsoft/onnxruntime, MIT) | verbatim |

Upstream artifact hashes (SHA-256):

- `piper_phonemize.js` `fef0c2fc442d24fdef5c7c7cc37d5da2314407640fe11ab1bfe347c723dff19b`
- `piper_phonemize.wasm` `b777cd107a91d2bcc6a1ea46f2c26a662a7407394fe84589198aeaa83dd7a9d6`
- `piper_phonemize.data` `29f1025eb23a5b5c192cd14a6efbce4509402ff265405072ee6f7d1a09b78f8c`
- unpatched `piper_worker.js` (piper-wasm@0.1.4) `92839bd481c095fe8f23bf1f06f35f06a12b6c0ad5fcb8c685ab0a9a7d7f6916`
- `onnxruntime-web-1.17.1.tgz` (npm registry tarball the `onnxruntime/` files were extracted from) `d48e46a437bc11d6b3a30e587fbae8aaa5061b567230e9aeecb5bc5059fcbd02`

## Patch list — `piper_worker.js`

The first six patches were formerly applied at install time by
`scripts/patch_piper_worker.js` (its anchor strings are frozen as fixtures in
`src/lib/tts/providers/piperVendoredAssets.test.ts`, the CI smoke that replaced the
script's warn-and-continue failure mode); they are now baked into the committed source:

1. **Config passing** — `module.FS.createDataFile("/", "config.json", …)` + `--config
   /config.json` on the phonemize `callMain` invocation (required for WASM phonemize).
2. **Phoneme-id clamp** — out-of-vocabulary phoneme ids (`> num_symbols - 1`) are
   replaced with 0 instead of crashing the inference engine with an OOB memory access.
3. **Global error handlers** — `self.onerror` / `self.onunhandledrejection` post
   `{kind:'error'}` back instead of failing silently.
4. **PCM2WAV documentation** — RIFF header JSDoc (comments only).
5. **Listener try/catch** — the message listener posts `{kind:'error'}` on synchronous
   dispatch failures.
6. **init try/catch** — async failures inside `init()` post `{kind:'error'}`.

Added at vendor time (Versicle-authored, not from the patch script):

7. **Request-id envelope** — `init()` captures `data.requestId` and stamps it on every
   terminal message (`output` / `complete` / `error`), so `PiperRuntime`
   (src/lib/tts/providers/PiperRuntime.ts) can drop stale replies instead of relying on
   per-call `onmessage` reassignment (the pre-5a cross-talk hazard).
8. **Per-chunk `init` re-entry costs** — `PiperRuntime.generate()` posts one
   `{kind:"init"}` per synthesized chunk, so everything `init()`/`phonemize()` re-did was
   PER-SENTENCE work. Three changes, all inside the existing request-id protocol (the
   protocol itself is untouched):
   - a module-level `urlCache` + `assetUrl(url, blobs)` helper mints ONE object URL per
     asset for the worker's lifetime. Each run previously called
     `URL.createObjectURL` afresh for `piper_phonemize.{js,wasm,data}` and `ort.min.js`
     and never revoked them, so the worker's blob-URL registry grew by four entries per
     sentence, each pinning its blob.
   - both `importScripts` calls are guarded on their global
     (`typeof createPiperPhonemize === "undefined"`, `typeof ort === "undefined"`):
     piper_phonemize.js (120 KB) and ort.min.js (540 KB) were re-parsed every sentence.
   - the ONNX session cache releases what it drops: every `cachedSession[k].release()` is
     awaited before the `cachedSession = {}` reset on a model switch (ort holds the model
     weights in the WASM heap; dropping the reference alone never frees them), and the
     model's object URL is revoked once `InferenceSession.create` resolves (ort fetches
     that URL exactly once inside `create` and copies the bytes into the heap, so the URL
     is dead afterwards — leaving it registered pinned the whole model blob).

   NOT done here, and deliberately: reusing the Emscripten phonemizer *module* across
   `callMain` invocations (a `createPiperPhonemize()` instance per sentence still
   re-initialises the espeak-ng MEMFS image). `callMain` is not re-entrant in the general
   case and the espeak data file is re-created per instance, so that one needs device
   verification before it lands.

## Licensing

- The combined Versicle work is **GPL-3.0-or-later** (see `third-party/inventory.json`
  → `licenseFloor`). `piper_phonemize.wasm`/`.data` embed **espeak-ng (GPL-3.0)**;
  piper-wasm's blanket MIT `package.json` claim does not cover those blobs.
- **Known provenance gap, recorded honestly** (carried verbatim from the licensing
  inventory): the exact espeak-ng and piper-phonemize commits compiled into the WASM
  are recorded nowhere by the upstream DavidCks/piper-wasm build, so GPLv3 §6
  corresponding source is currently unidentifiable for the binary. The long-term fix —
  rebuilding the WASM from pinned commits in CI — remains a recorded follow-up
  (gap report D3), NOT resolved by vendoring.
- `piper_phonemize.js`, `piper_worker.js`: MIT (DavidCks/piper-wasm wrapper code).
- `onnxruntime/**`: MIT (Microsoft). Vendored locally so synthesis performs **zero
  third-party egress** (the cdnjs default URL died with this change).

## Compatibility constraints (do not break)

- The runtime URL layout is `/piper/piper_worker.js`, `/piper/piper_phonemize.*`,
  `/piper/onnxruntime/` — unchanged from the postinstall era, so users' existing
  Cache-API entries and service-worker state stay valid.
- The Cache API model store name `piper-voices-v1` and its HuggingFace-URL keys are
  untouched: voices users downloaded before the vendoring keep working
  (pinned by `PiperProvider.test.ts` offline-catalog tests).
