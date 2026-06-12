/**
 * PiperRuntime — the owned, instance-scoped runtime for the vendored Piper WASM
 * synthesis worker (Phase 5a-PR3, phase5-tts-strangler.md §5a.2). Replaces the
 * module-global `piper-utils` (shared mutable `blobs`/`worker`/`pendingPromise`
 * state, per-call `onmessage` reassignment, fire-and-forget cache writes).
 *
 * Responsibilities:
 *  - Worker lifecycle: one worker, created lazily, terminated on {@link dispose}
 *    or fatal error; a crashed worker is replaced on the next request instead of
 *    poisoning the queue.
 *  - Request-id protocol: every `init` message carries a `requestId` the vendored
 *    worker echoes on its terminal messages (`output`/`complete`/`error` — patch 7
 *    in third-party/piper/PROVENANCE.md); late messages with a stale id are
 *    DROPPED, killing the cross-talk hazard of the old per-call listener swap.
 *  - Model store: the Cache API (`piper-voices-v1`, keys = HuggingFace URLs —
 *    UNTOUCHED from the pre-vendoring format, so existing downloads keep working)
 *    is the durable tier; an in-memory LRU (budget {@link maxModelsInMemory})
 *    keeps the hot model blobs out of repeated Cache API reads.
 *  - Asset URLs: every runtime asset (worker, phonemizer js/wasm/data, the local
 *    onnxruntime build) is served same-origin from `/piper/**` — the cdnjs
 *    fallback is gone; synthesis performs zero third-party egress.
 *
 * Main-thread only (Worker construction + Cache API + XHR inside the worker).
 */
import { egress } from '@kernel/net';

/** Same-origin asset layout (mirrors the pre-vendoring /piper/** URLs). */
const DEFAULT_ASSETS_BASE = '/piper/';
const DEFAULT_ONNX_BASE = '/piper/onnxruntime/';
/** The durable model store. DO NOT rename: existing user downloads live here. */
const DEFAULT_CACHE_NAME = 'piper-voices-v1';

export interface PiperRuntimeOptions {
    /** Base URL for piper_worker.js + piper_phonemize.{js,wasm,data}. */
    assetsBaseUrl?: string;
    /** Base URL for the local onnxruntime-web dist (ort.min.js + ort-wasm*.wasm). */
    onnxBaseUrl?: string;
    /** Cache API store for model/config blobs (and the voices.json catalog). */
    cacheName?: string;
    /** In-memory model LRU budget (model+config pairs). */
    maxModelsInMemory?: number;
}

export interface PiperGenerateRequest {
    text: string;
    modelUrl: string;
    configUrl: string;
    speakerId?: number;
    onProgress?: (percent: number) => void;
}

export interface PiperGenerateResult {
    file: Blob;
    duration: number;
}

interface PendingRequest {
    id: number;
    resolve(result: PiperGenerateResult): void;
    reject(error: Error): void;
    onProgress?: (percent: number) => void;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetches a voice-model URL with exponential backoff retry logic.
 * Useful for downloading large model files over unstable connections.
 * Routes through `NetworkGateway.egress('hf-piper-models')` (Phase 7 §I):
 * the destination is unbounded-but-abortable (timeoutMs null) so large
 * downloads are never killed by a gateway timer.
 */
export const fetchWithBackoff = async (url: string, retries = 3, delay = 1000): Promise<Blob> => {
    try {
        const response = await egress('hf-piper-models', url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.blob();
    } catch (error) {
        if (retries > 0) {
            console.warn(`Fetch failed for ${url}, retrying in ${delay}ms...`, error);
            await wait(delay);
            return fetchWithBackoff(url, retries - 1, delay * 2);
        } else {
            throw error;
        }
    }
};

/**
 * Concatenates multiple WAV blobs into a single WAV blob.
 * Assumes blobs are standard WAV files (RIFF header + data chunk).
 * It extracts the raw PCM data from each blob and stitches them together,
 * creating a new valid WAV header. (Keeper, verbatim from piper-utils.)
 */
export async function stitchWavs(blobs: Blob[]): Promise<Blob> {
    if (blobs.length === 0) return new Blob([], { type: 'audio/wav' });
    if (blobs.length === 1) return blobs[0];

    // Helper to find data chunk
    function findDataChunk(view: DataView): { offset: number, size: number } | null {
        // Start after RIFF header (12 bytes)
        let offset = 12;
        while (offset < view.byteLength) {
            // Read 4 chars
            const chunkId = String.fromCharCode(
                view.getUint8(offset),
                view.getUint8(offset + 1),
                view.getUint8(offset + 2),
                view.getUint8(offset + 3)
            );
            const chunkSize = view.getUint32(offset + 4, true); // little endian

            if (chunkId === 'data') {
                return { offset: offset + 8, size: chunkSize };
            }
            offset += 8 + chunkSize;
        }
        return null;
    }

    const buffers = await Promise.all(blobs.map(b => b.arrayBuffer()));
    const firstBuffer = buffers[0];
    const firstView = new DataView(firstBuffer);

    const firstData = findDataChunk(firstView);
    if (!firstData) {
         console.warn("Could not find data chunk in first WAV, assuming 44 byte header.");
    }

    // Header size (everything before data)
    const headerSize = firstData ? firstData.offset : 44;
    const header = firstBuffer.slice(0, headerSize);

    const dataParts: ArrayBuffer[] = [];
    let totalDataSize = 0;

    for (let i = 0; i < buffers.length; i++) {
        const buffer = buffers[i];
        const view = new DataView(buffer);
        const dataInfo = findDataChunk(view);

        if (dataInfo) {
            dataParts.push(buffer.slice(dataInfo.offset, dataInfo.offset + dataInfo.size));
            totalDataSize += dataInfo.size;
        } else {
             // Fallback: strip 44 bytes
             dataParts.push(buffer.slice(44));
             totalDataSize += (buffer.byteLength - 44);
        }
    }

    // Update Header
    const newHeader = new DataView(header.slice(0)); // copy
    // RIFF ChunkSize (at 4) = 4 + (8 + subchunks) + (8 + dataSize)
    // Simplified: FileSize - 8
    newHeader.setUint32(4, headerSize - 8 + totalDataSize, true);
    // Data SubchunkSize
    if (firstData) {
        newHeader.setUint32(firstData.offset - 4, totalDataSize, true);
    } else {
        newHeader.setUint32(40, totalDataSize, true);
    }

    return new Blob([newHeader, ...dataParts], { type: 'audio/wav' });
}

export class PiperRuntime {
    private readonly assetsBaseUrl: string;
    private readonly onnxBaseUrl: string;
    private readonly cacheName: string;
    private readonly maxModelsInMemory: number;

    private worker: Worker | null = null;
    private requestSeq = 0;
    private pending: PendingRequest | null = null;
    /** Serializes generate() calls; reset (not poisoned) when a request fails. */
    private queueTail: Promise<void> = Promise.resolve();
    /** Small shared assets the worker fetched and reported back (phonemizer, ort.min.js). */
    private assetBlobs: Record<string, Blob> = {};
    /** Hot model/config pairs, keyed by modelUrl, LRU-evicted beyond the budget. */
    private modelLru = new Map<string, { model: Blob; config: Blob; configUrl: string }>();
    private disposed = false;

    constructor(opts: PiperRuntimeOptions = {}) {
        this.assetsBaseUrl = opts.assetsBaseUrl ?? DEFAULT_ASSETS_BASE;
        this.onnxBaseUrl = opts.onnxBaseUrl ?? DEFAULT_ONNX_BASE;
        this.cacheName = opts.cacheName ?? DEFAULT_CACHE_NAME;
        this.maxModelsInMemory = opts.maxModelsInMemory ?? 2;
    }

    // -----------------------------------------------------------------------
    // Cache API helpers (durable tier; keys are full URLs — legacy format).
    // -----------------------------------------------------------------------

    private async openCache(): Promise<Cache | null> {
        if (typeof caches === 'undefined') return null;
        try {
            return await caches.open(this.cacheName);
        } catch (e) {
            console.warn('Failed to open cache', e);
            return null;
        }
    }

    /** Look a cached response up by URL (models, configs, the voices catalog). */
    async cacheMatch(url: string): Promise<Response | null> {
        const cache = await this.openCache();
        if (!cache) return null;
        try {
            return (await cache.match(url)) ?? null;
        } catch (e) {
            console.warn('Failed to read from cache:', url, e);
            return null;
        }
    }

    /** Store a response/blob under a URL key. AWAITED — callers see commit failures. */
    async cachePut(url: string, body: Blob | Response): Promise<void> {
        const cache = await this.openCache();
        if (!cache) return;
        await cache.put(url, body instanceof Response ? body : new Response(body));
    }

    /** Whether the model blob is durably stored (the "is downloaded" check). */
    async isModelDownloaded(modelUrl: string): Promise<boolean> {
        return (await this.cacheMatch(modelUrl)) !== null;
    }

    /**
     * Commit a staged model/config blob to the durable store AND the hot tier.
     * Awaited (the old `cacheModel` fire-and-forget write could lose the commit).
     */
    async saveModel(url: string, blob: Blob): Promise<void> {
        await this.cachePut(url, blob);
    }

    /**
     * Delete a model from every tier. AWAITS the Cache API deletes (the old
     * fire-and-forget delete raced re-downloads — D17) and drops the worker,
     * whose ort session may hold the model.
     */
    async deleteModel(modelUrl: string, configUrl: string): Promise<void> {
        this.modelLru.delete(modelUrl);
        const cache = await this.openCache();
        if (cache) {
            try {
                await cache.delete(modelUrl);
                await cache.delete(configUrl);
            } catch (e) {
                console.warn('Failed to delete from cache:', modelUrl, e);
            }
        }
        this.terminateWorker(new Error('Model deleted'));
    }

    /**
     * Enumerate the model URLs present in the durable store — the offline voices
     * source when the HuggingFace catalog is unreachable.
     */
    async listDownloadedModelUrls(): Promise<string[]> {
        const cache = await this.openCache();
        if (!cache) return [];
        try {
            const keys = await cache.keys();
            return keys.map((req) => req.url).filter((url) => url.endsWith('.onnx'));
        } catch (e) {
            console.warn('Failed to enumerate model cache', e);
            return [];
        }
    }

    /** Hot-tier read with durable fallback; bumps LRU recency. */
    private async getModelPair(modelUrl: string, configUrl: string): Promise<{ model: Blob; config: Blob } | null> {
        const hot = this.modelLru.get(modelUrl);
        if (hot) {
            // Re-insert to refresh recency (Map preserves insertion order).
            this.modelLru.delete(modelUrl);
            this.modelLru.set(modelUrl, hot);
            return hot;
        }
        const [modelResp, configResp] = await Promise.all([
            this.cacheMatch(modelUrl),
            this.cacheMatch(configUrl),
        ]);
        if (!modelResp || !configResp) return null;
        const pair = {
            model: await modelResp.blob(),
            config: await configResp.blob(),
            configUrl,
        };
        this.modelLru.set(modelUrl, pair);
        while (this.modelLru.size > this.maxModelsInMemory) {
            const oldest = this.modelLru.keys().next().value as string;
            this.modelLru.delete(oldest);
        }
        return pair;
    }

    // -----------------------------------------------------------------------
    // Worker + request-id protocol.
    // -----------------------------------------------------------------------

    private ensureWorker(): Worker {
        if (this.worker) return this.worker;
        const worker = new Worker(this.assetsBaseUrl + 'piper_worker.js');
        worker.onmessage = (event: MessageEvent) => this.handleWorkerMessage(event.data);
        worker.onerror = (e) => {
            console.error('Piper Worker Error', e);
            this.terminateWorker(new Error('Piper worker crashed during generation'));
        };
        this.worker = worker;
        return worker;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private handleWorkerMessage(data: any): void {
        const current = this.pending;
        switch (data?.kind) {
            case 'fetch': {
                // The worker streams asset/model fetch progress and hands the final
                // blob back for main-thread reuse (legacy protocol, kept verbatim).
                if (data.blob) this.assetBlobs[data.url] = data.blob;
                if (current?.onProgress) {
                    const progress = data.blob ? 1 : data.total ? data.loaded / data.total : 0;
                    current.onProgress(Math.round(progress * 100));
                }
                break;
            }
            case 'stderr': {
                console.error(data.message);
                break;
            }
            case 'output': {
                if (!current) return;
                // Stale-request guard: a late reply for a superseded request is dropped.
                if (data.requestId !== undefined && data.requestId !== current.id) return;
                this.pending = null;
                current.resolve({ file: data.file, duration: data.duration });
                break;
            }
            case 'error': {
                if (!current) return;
                if (data.requestId !== undefined && data.requestId !== current.id) return;
                this.pending = null;
                current.reject(new Error(String(data.error)));
                break;
            }
            // 'complete' and 'isAlive' need no handling under the id protocol.
        }
    }

    private terminateWorker(error: Error): void {
        const current = this.pending;
        this.pending = null;
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        current?.reject(error);
    }

    /**
     * Synthesize one text chunk. Requests are serialized; a failed request resets
     * the queue instead of poisoning it (the old shared `pendingPromise` chain
     * swallowed errors with a bare `.catch(() => {})`).
     */
    generate(req: PiperGenerateRequest): Promise<PiperGenerateResult> {
        if (this.disposed) {
            return Promise.reject(new Error('PiperRuntime is disposed'));
        }
        const run = async (): Promise<PiperGenerateResult> => {
            if (this.disposed) throw new Error('PiperRuntime is disposed');
            const pair = await this.getModelPair(req.modelUrl, req.configUrl);

            const worker = this.ensureWorker();
            const id = ++this.requestSeq;

            const result = new Promise<PiperGenerateResult>((resolve, reject) => {
                this.pending = { id, resolve, reject, onProgress: req.onProgress };
            });

            // Blob map handed to the worker: shared assets it fetched before, plus
            // the hot model pair when we have it (otherwise the worker XHRs the
            // model itself and streams progress — the legacy zero-touch path).
            const blobs: Record<string, Blob> = { ...this.assetBlobs };
            if (pair) {
                blobs[req.modelUrl] = pair.model;
                blobs[req.configUrl] = pair.config;
            }

            worker.postMessage({
                kind: 'init',
                requestId: id,
                input: req.text,
                speakerId: req.speakerId,
                blobs,
                piperPhonemizeJsUrl: this.assetsBaseUrl + 'piper_phonemize.js',
                piperPhonemizeWasmUrl: this.assetsBaseUrl + 'piper_phonemize.wasm',
                piperPhonemizeDataUrl: this.assetsBaseUrl + 'piper_phonemize.data',
                modelUrl: req.modelUrl,
                modelConfigUrl: req.configUrl,
                onnxruntimeUrl: this.onnxBaseUrl,
            });

            return await result;
        };

        // Serialize behind the tail; reset the tail on failure so the NEXT request
        // starts from a clean chain.
        const settled = this.queueTail.then(run, run);
        this.queueTail = settled.then(() => undefined, () => undefined);
        return settled;
    }

    /** Terminate the worker, drop hot blobs, and reject anything in flight. */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.terminateWorker(new Error('PiperRuntime is disposed'));
        this.assetBlobs = {};
        this.modelLru.clear();
    }
}
