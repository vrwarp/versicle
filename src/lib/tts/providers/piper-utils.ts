
const blobs: Record<string, Blob> = {};
const CACHE_NAME = 'piper-voices-v1';

let worker: Worker | null = null;
let currentWorkerUrl: string | null = null;
let pendingPromise: Promise<void> = Promise.resolve();

// --- Cache API Helpers ---

/**
 * Opens the specific CacheStorage for Piper voices.
 * Returns null if Cache API is unavailable (e.g. non-secure context or older browser).
 */
const getCache = async () => {
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch (e) {
    console.warn('Failed to open cache', e);
    return null;
  }
};

/**
 * Stores a blob in the persistent CacheStorage.
 * Failures are logged but do not block execution (best effort).
 */
const storeInCache = async (url: string, blob: Blob) => {
  const cache = await getCache();
  if (!cache) return;
  try {
    await cache.put(url, new Response(blob));
  } catch (e) {
    console.warn('Failed to cache file:', url, e);
  }
};

/**
 * Retrieves a blob from the persistent CacheStorage.
 * Returns null if not found or if Cache API fails.
 */
const loadFromCache = async (url: string): Promise<Blob | null> => {
  const cache = await getCache();
  if (!cache) return null;
  try {
    const response = await cache.match(url);
    if (response) return await response.blob();
  } catch (e) {
    console.warn('Failed to load from cache:', url, e);
  }
  return null;
};

/**
 * Removes a file from the persistent CacheStorage.
 */
const removeFromCache = async (url: string) => {
  const cache = await getCache();
  if (!cache) return;
  try {
    await cache.delete(url);
  } catch (e) {
    console.warn('Failed to delete from cache:', url, e);
  }
};

/**
 * Checks if a model file exists in the persistent CacheStorage.
 * This is the primary check for "is downloaded" status.
 */
export const isModelPersisted = async (modelUrl: string): Promise<boolean> => {
    const cache = await getCache();
    if (!cache) return false;
    try {
        const match = await cache.match(modelUrl);
        return !!match;
    } catch {
        return false;
    }
};

// --- Core Utils ---

/**
 * Caches the model in both memory (blobs map) and persistent storage (Cache API).
 * The in-memory map is used by the worker for immediate access.
 */
export const cacheModel = (url: string, blob: Blob) => {
  blobs[url] = blob;
  storeInCache(url, blob).catch(e => console.error("Background cache write failed", e));
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetches a URL with exponential backoff retry logic.
 * Useful for downloading large model files over unstable connections.
 */
export const fetchWithBackoff = async (url: string, retries = 3, delay = 1000): Promise<Blob> => {
  try {
    const response = await fetch(url);
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
 * Checks if the model is currently loaded in the worker.
 * Used internally to determine if we need to restart/init the worker.
 */
export const isModelLoadedInWorker = async (modelUrl: string): Promise<boolean> => {
  return new Promise<boolean>((resolve) => {
    pendingPromise = pendingPromise.then(async () => {
        if (!worker) {
            resolve(false);
            return;
        }

        let resolved = false;

        const cleanup = () => {
            if (worker) worker.onmessage = null;
        };

        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                cleanup();
                resolve(false);
            }
        }, 2000);

        worker.onmessage = (event: MessageEvent) => {
            if (event.data.kind === "isAlive") {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    cleanup();
                    resolve(event.data.isAlive);
                }
            }
        };

        worker.postMessage({ kind: "isAlive", modelUrl });
    }).catch(() => resolve(false));
  });
};


/**
 * Deletes a model from both memory and persistent storage.
 * Also terminates the worker to ensure no stale state remains.
 */
export const deleteCachedModel = (modelUrl: string, modelConfigUrl: string) => {
  if (blobs[modelUrl]) delete blobs[modelUrl];
  if (blobs[modelConfigUrl]) delete blobs[modelConfigUrl];

  removeFromCache(modelUrl);
  removeFromCache(modelConfigUrl);

  if (worker) {
      worker.terminate();
      worker = null;
      currentWorkerUrl = null;
  }
};

/**
 * Ensures that the model and config files are loaded into the in-memory 'blobs' map.
 * If they are missing from memory but exist in persistent cache, they are loaded.
 * This is crucial for restoring state after a page reload.
 */
async function ensureModelLoaded(modelUrl: string, modelConfigUrl: string) {
    if (!blobs[modelUrl]) {
        const blob = await loadFromCache(modelUrl);
        if (blob) blobs[modelUrl] = blob;
    }
    if (!blobs[modelConfigUrl]) {
        const blob = await loadFromCache(modelConfigUrl);
        if (blob) blobs[modelConfigUrl] = blob;
    }
}

/**
 * Concatenates multiple WAV blobs into a single WAV blob.
 * Assumes blobs are standard WAV files (RIFF header + data chunk).
 * It extracts the raw PCM data from each blob and stitches them together,
 * creating a new valid WAV header.
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

export const piperGenerate = async (
  piperPhonemizeJsUrl: string,
  piperPhonemizeWasmUrl: string,
  piperPhonemizeDataUrl: string,
  workerUrl: string,
  modelUrl: string,
  modelConfigUrl: string,
  speakerId: number | undefined,
  input: string,
  onProgress: (progress: number) => void,
  onnxruntimeUrl = "https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.17.1/"
): Promise<{ file: Blob; duration: number }> => {

  // Load from cache to memory if needed
  await ensureModelLoaded(modelUrl, modelConfigUrl);

  return new Promise((resolve, reject) => {
      pendingPromise = pendingPromise.then(async () => {
          try {
              if (!worker || currentWorkerUrl !== workerUrl) {
                  if (worker) worker.terminate();
                  worker = new Worker(workerUrl);
                  currentWorkerUrl = workerUrl;
                  worker.onerror = (e) => {
                      console.error("Piper Worker Error", e);
                      // Let it crash
                      if (worker) worker.terminate();
                      worker = null;
                      currentWorkerUrl = null;
                  };
              }

              // Capture worker instance locally to satisfy TypeScript and ensure consistency
              const w = worker;
              const result = await new Promise<{ file: Blob; duration: number }>((innerResolve, innerReject) => {
                   if (!w) {
                       innerReject(new Error("Failed to create worker"));
                       return;
                   }

                   // Attach temporary listener
                   const cleanup = () => {
                       w.onmessage = null;
                   };

                   // Handle errors during this specific task
                   const oldOnError = w.onerror;
                   w.onerror = (e) => {
                       if (oldOnError) oldOnError.call(w, e);
                       cleanup();
                       innerReject(new Error("Worker crashed during generation"));
                   };

                   w.onmessage = (event: MessageEvent) => {
                        const data = event.data;
                        switch (data.kind) {
                          case "output": {
                            cleanup();
                            // Restore onerror
                            w.onerror = oldOnError;
                            innerResolve({ file: data.file, duration: data.duration });
                            break;
                          }
                          case "stderr": {
                            console.error(data.message);
                            break;
                          }
                          case "fetch": {
                            if (data.blob) blobs[data.url] = data.blob;
                            const progress = data.blob
                              ? 1
                              : data.total
                              ? data.loaded / data.total
                              : 0;
                            onProgress(Math.round(progress * 100));
                            break;
                          }
                          case "error": {
                              cleanup();
                              w.onerror = oldOnError;
                              innerReject(new Error(data.error));
                              break;
                          }
                        }
                   };

                   w.postMessage({
                        kind: "init",
                        input,
                        speakerId,
                        blobs,
                        piperPhonemizeJsUrl,
                        piperPhonemizeWasmUrl,
                        piperPhonemizeDataUrl,
                        modelUrl,
                        modelConfigUrl,
                        onnxruntimeUrl,
                        workerUrl
                   });
              });

              resolve(result);

          } catch (e) {
              reject(e);
          }
      }).catch(() => {});
  });
};
