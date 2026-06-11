#!/usr/bin/env node
/**
 * tts-storage localStorage fixture capture (phase5-tts-strangler.md §5b.4 step 3).
 *
 * Mirrors scripts/capture-ydoc-fixture.ts: runs the CURRENT app store under vitest-jsdom
 * (src/store/__fixtures__/capture-tts-storage.test.ts, gated behind CAPTURE_TTS_STORAGE=1)
 * and writes src/store/__fixtures__/tts-storage.v3.json.
 *
 *   node scripts/capture-tts-storage.ts
 *
 * The v1/v2 era variants beside it are HAND-DERIVED from the legacy migration chain
 * (useTTSStore persist migrate, versions 1→2→3) — see src/store/__fixtures__/README.md.
 * All three blobs are CHECKED IN AND REVIEWED, never regenerated in CI;
 * src/store/__fixtures__/ttsStorageFixtures.test.ts pins the migration chain against them
 * (and is the regression floor the 5b-PR5 tts-settings split must keep green).
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

execFileSync('npx', ['vitest', 'run', 'src/store/__fixtures__/capture-tts-storage.test.ts'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, CAPTURE_TTS_STORAGE: '1' },
});
