# Provenance — `@jofr/capacitor-media-session` (vendored)

This is a **vendored, locally-patched copy** of a Capacitor Media Session plugin.
It is consumed by versicle as a `file:` dependency (`packages/capacitor-media-session`)
rather than a registry/git dependency, so the native Media3 code is first-party,
inspectable, and patchable in-tree. Changes here are kept **diff-minimal and
upstreamable**.

## Lineage

| Layer | Repo | Notes |
| --- | --- | --- |
| Original upstream | https://github.com/jofr/capacitor-media-session | `@jofr/capacitor-media-session` (GPL-3.0-or-later), legacy `androidx.media` impl |
| Fork (Media3 migration) | https://github.com/vrwarp/capacitor-media-session | branch `antigravity`, migrates Android to AndroidX Media3 (`media3-session`/`media3-common` 1.2.0) via a `WebViewProxyPlayer` (SimpleBasePlayer); JS action API is event-listener based (`setActionHandler({action})` + `addListener('onMediaAction')`) |
| Vendored from | `vrwarp/capacitor-media-session@2f8c6fa20eca5ea449c1a54514eb7001279d1b07` | full source tree (minus `example/`); `dist/` is the `prepare`-built output of that SHA |

License: **GPL-3.0-or-later** (unchanged). The upstream `LICENSE` is retained verbatim.

## Why vendored (vs the prior `git+https` pin)

The fork's `main`/npm path is broken (no committed `dist/`, builds only via a
`prepare` hook), and a SHA-pinned `git+https` dep is awkward to patch and verify.
Vendoring makes the two device-fixing changes below auditable in-tree and removes
the install-time build fragility.

## Vendoring deltas (versicle-copy-only; do NOT upstream these two)

- **`dist/` is committed** and the upstream `dist` `.gitignore` entry removed —
  a `file:` dependency does not run `prepare`, so the prebuilt output must be present.
- **`scripts.prepare` removed** from `package.json` for the same reason.
- **`android/src/test/.../MediaSessionPluginTest.java` removed** — it verifies Capacitor's
  `protected` `notifyListeners(String, JSObject)` directly, which compiles under the fork's
  Capacitor 6 devDeps but NOT against versicle's Capacitor 7 (protected access from a
  non-subclass test). versicle's Android CI runs `./gradlew test` across all modules, so an
  uncompilable test sourceset would break it. The fork repo retains this test for its
  Capacitor-6 matrix; coverage of the plugin under Capacitor 7 lives in versicle's own
  `android/app/src/test/.../MediaSessionPluginTest.java` (Bridge-driven) plus the new
  `ArtworkScalingTest`.
- **`devDependencies` removed** from `package.json` — a `file:` directory dependency
  otherwise installs the target's devDeps (the upstream eslint 7 / rollup 2 / swiftlint /
  docgen toolchain) into versicle's `node_modules` on every install. The package is a
  frozen vendored artifact with committed `dist/`, so its build toolchain is not needed
  here. The peer range was widened to `^6.0.0 || ^7.0.0` (versicle runs Capacitor 7).

## Functional modifications (DO upstream these to vrwarp/jofr)

All changes are Android-only and fix the two device failures diagnosed against
media3-session 1.2.0:

1. **`MediaSessionService.onCreate` now calls `addSession(mediaSession)`** — attaches
   Media3's `MediaNotificationManager` so the foreground media notification / lock-screen
   controls actually post. Previously `addSession()` never ran (the plugin binds with an
   actionless intent + a `LocalBinder`; `super.onBind` / `onStartCommand` / a connecting
   `MediaController` never fire), so no notification ever appeared.
2. **`MediaSessionService.onStartCommand` → `START_NOT_STICKY`** and **`onTaskRemoved`
   stops the service when idle/not-playing** — the proxy mirrors WebView-produced audio
   with no native resume path, so it must not be resurrected as a sessionless zombie.
3. **`MediaSessionPlugin.bitmapToByteArray` downscales artwork to a 512px long edge and
   encodes JPEG (q85)** instead of full-size PNG — oversized bitmaps crossing the Binder
   to the platform MediaSession have crashed `com.android.bluetooth`. New pure helper
   `computeScaledDimensions(w,h,maxEdge)` is unit-tested in
   `android/src/test/.../ArtworkScalingTest.java`.

The companion JS-side fix (mapping transient `loading`/`completed` TTS states to
`playing` so the proxy never reports `STATE_IDLE` mid-utterance) lives in versicle's
`src/lib/tts/PlatformIntegration.ts`, not in this package.

## Rebuilding `dist/`

`src/**` is unchanged by the modifications above (they are all under `android/`), so the
committed `dist/` already matches `src/` and normally never needs rebuilding. If `src/**`
ever changes, rebuild from the upstream fork repo (which retains the full devDependency
toolchain and `prepare`/`build` scripts) and copy the resulting `dist/` back here — the
devDeps were intentionally stripped from this vendored copy (see above).
