# Utility scripts

Build, verification, and maintenance scripts. Each script's header comment
is its full documentation; this is the index. (A `generate_pwa_icons.py`
documented here historically does not exist.)

| Script | Run via | Purpose |
|---|---|---|
| `check-worker-chunk.mjs` | `npm run check:worker-chunk` (`-- --skip-build` to reuse `dist/`) | Builds the app and asserts the TTS worker chunk's import closure contains no zustand/yjs/`src/store/` code (C12 worker-purity contract). |
| `depcruise-baseline.mjs` | `npm run depcruise:baseline` / `npm run depcruise:check` | Freezes/checks dependency-cruiser violation counts against `.dependency-cruiser-baseline.json` (Phase 0 ratchet — counts only go down). |
| `generate-third-party-notices.mjs` | `npm run licenses:generate` | Regenerates `THIRD-PARTY-NOTICES.md` from `third-party/inventory.json` + the production npm tree. Commit the result. |
| `license-gate.mjs` | `npm run licenses:check` | CI gate: production deps must be GPL-3.0-compatible per `third-party/license-allowlist.json`; inventory entries must be complete. |
| `compile-dict.cjs` | manual | Compiles `public/dict/cedict.json` offline from the vendored snapshot `cedict-source.zip` (pinned by `cedict.lock.json`). `--update-lock` fetches MDBG and re-vendors + re-pins (automated monthly via `update-dict.yml`). |
| `install_android_sdk.sh` | manual | Installs an Android SDK for local (non-Docker) Android builds. |

Testing commands themselves are documented in `TESTING.md` (repo root).
