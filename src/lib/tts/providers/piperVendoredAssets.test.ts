/**
 * Vendored Piper asset smoke (5a-PR3) — the CI replacement for the deleted
 * install-time patcher (`scripts/patch_piper_worker.js`), whose failure mode was
 * warn-and-continue: a silently unpatched worker shipped without anyone noticing.
 *
 * The worker is now COMMITTED SOURCE at `third-party/piper/piper_worker.js`
 * (served verbatim at `/piper/piper_worker.js` — see the vite plugin). This test
 * asserts the functional patches are present, using anchor strings frozen from
 * the patch script before its deletion (patch list:
 * third-party/piper/PROVENANCE.md), and that every runtime asset the worker
 * needs ships in the vendor directory — including the LOCAL onnxruntime build
 * that replaced the cdnjs default (no third-party egress during synthesis).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const VENDOR_DIR = resolve(process.cwd(), 'third-party/piper');

describe('vendored piper assets (third-party/piper)', () => {
    let workerSource: string;

    beforeAll(() => {
        workerSource = readFileSync(resolve(VENDOR_DIR, 'piper_worker.js'), 'utf8');
    });

    describe('piper_worker.js carries the committed patches', () => {
        it('patch 1 — config passing to the WASM phonemizer (anchors from patch_piper_worker.js:25-51)', () => {
            expect(workerSource).toContain('module.FS.createDataFile(');
            expect(workerSource).toContain('"config.json"');
            expect(workerSource).toContain('"--config",');
            expect(workerSource).toContain('"/config.json"');
        });

        it('patch 2 — phoneme-id clamp (anchors from patch_piper_worker.js:72-82)', () => {
            expect(workerSource).toContain('if (modelConfig.num_symbols) {');
            expect(workerSource).toContain('out of bounds (max ');
            expect(workerSource).toContain('phonemeIds[i] = 0;');
        });

        it('patch 3 — global error handlers (anchors from patch_piper_worker.js:103-118)', () => {
            expect(workerSource).toContain('// Global error handlers');
            expect(workerSource).toContain('self.onerror = function');
            expect(workerSource).toContain('self.onunhandledrejection = function');
        });

        it('patches 5/6 — listener + init try/catch report errors instead of dying silently', () => {
            expect(workerSource).toContain("self.postMessage({ kind: 'error', error: err.toString() });");
            expect(workerSource).toContain("self.postMessage({ kind: 'error', requestId, error: err.toString() });");
        });

        it('patch 7 — request-id envelope on every terminal message (PiperRuntime protocol)', () => {
            expect(workerSource).toContain('const requestId = data.requestId;');
            expect(workerSource).toContain('kind: "output",\n    requestId,');
            expect(workerSource).toContain('self.postMessage({ kind: "complete", requestId });');
        });

        // Patch 8 (2026 perf pass): `init` runs once per SYNTHESIZED CHUNK, so everything it
        // re-did was per-sentence work — four freshly minted (never revoked) object URLs and
        // two importScripts of ~660 KB of JavaScript. These anchors pin the fix the way the
        // patch-script anchors above pin patches 1–7.
        it('patch 8 — asset object URLs are minted once per worker, not once per sentence', () => {
            expect(workerSource).toContain('var urlCache = {};');
            expect(workerSource).toContain('async function assetUrl(url, blobs) {');
            expect(workerSource).toContain('urlCache[url] = URL.createObjectURL(await getBlob(url, blobs));');
            expect(workerSource).toContain('await assetUrl(data.piperPhonemizeJsUrl, blobs)');
            expect(workerSource).toContain('await assetUrl(data.piperPhonemizeWasmUrl, blobs)');
            expect(workerSource).toContain('await assetUrl(data.piperPhonemizeDataUrl, blobs)');
            expect(workerSource).toContain('await assetUrl(`${onnxruntimeBase}ort.min.js`, blobs)');
            // Exactly two mint sites survive: the cache itself, and the one-shot model URL.
            expect(workerSource.match(/URL\.createObjectURL\(/g) ?? []).toHaveLength(2);
        });

        it('patch 8 — importScripts runs only when the global is missing', () => {
            expect(workerSource).toContain('if (typeof createPiperPhonemize === "undefined") importScripts(piperPhonemizeJs);');
            expect(workerSource).toContain('if (typeof ort === "undefined") importScripts(onnxruntimeJs);');
            // No unguarded importScripts call may come back.
            expect(workerSource.match(/importScripts\(/g) ?? []).toHaveLength(2);
        });

        it('patch 8 — superseded ONNX sessions are released and the model URL is revoked', () => {
            expect(workerSource).toContain('await cachedSession[key].release();');
            expect(workerSource).toContain('URL.revokeObjectURL(modelObjectUrl);');
        });
    });

    it('ships every runtime asset the worker loads (same /piper/** layout as before)', () => {
        const required = [
            'piper_phonemize.js',
            'piper_phonemize.wasm',
            'piper_phonemize.data',
            'piper_worker.js',
            'PROVENANCE.md',
            // The local onnxruntime build (ort.env.wasm.wasmPaths = onnxBaseUrl):
            'onnxruntime/ort.min.js',
            'onnxruntime/ort-wasm.wasm',
            'onnxruntime/ort-wasm-simd.wasm',
            'onnxruntime/ort-wasm-threaded.wasm',
            'onnxruntime/ort-wasm-simd-threaded.wasm',
        ];
        for (const file of required) {
            const stats = statSync(resolve(VENDOR_DIR, file));
            expect(stats.size, file).toBeGreaterThan(0);
        }
    });

    it('no source references the deleted install-time pipeline or the cdnjs onnxruntime', () => {
        // The runtime defaults are same-origin; the worker itself must not hardcode
        // a CDN either (it receives onnxruntimeUrl from PiperRuntime).
        expect(workerSource).not.toContain('cdnjs.cloudflare.com');
    });
});
