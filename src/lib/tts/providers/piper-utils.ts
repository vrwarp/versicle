
const blobs: Record<string, Blob> = {};
let worker: Worker | undefined;

export const isModelCached = async (modelUrl: string): Promise<boolean> => {
  if (!worker) return false;

  return new Promise<boolean>((resolve) => {
    const aliveChecker = (event: MessageEvent) => {
      if (event.data.kind === "isAlive") {
        const { isAlive } = event.data;
        worker?.removeEventListener("message", aliveChecker);
        resolve(isAlive);
      }
    };
    worker?.addEventListener("message", aliveChecker);
    worker?.postMessage({
      kind: "isAlive",
      modelUrl,
    });
  });
};

export const deleteCachedModel = (modelUrl: string, modelConfigUrl: string) => {
  if (blobs[modelUrl]) delete blobs[modelUrl];
  if (blobs[modelConfigUrl]) delete blobs[modelConfigUrl];

  if (worker) {
    worker.terminate();
    worker = undefined;
  }
};

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
): Promise<{ file: string; duration: number }> => {

  if (!worker) {
    worker = new Worker(workerUrl);
  }

  // Check if worker is alive and has the model cached
  const alivePromise = new Promise<boolean>((resolve) => {
    const aliveChecker = (event: MessageEvent) => {
      if (event.data.kind === "isAlive") {
        const { isAlive } = event.data;
        worker?.removeEventListener("message", aliveChecker);
        if (isAlive) {
          resolve(true);
        } else {
          // If not alive (or different model), reset the worker to ensure clean state
          worker?.terminate();
          worker = new Worker(workerUrl);
          resolve(false);
        }
      }
    };
    worker?.addEventListener("message", aliveChecker);

    worker?.postMessage({
      kind: "isAlive",
      modelUrl,
    });
  });

  await alivePromise;

  return new Promise((resolve, reject) => {
    if (!worker) return reject("Worker not initialized");

    const msgHandler = (event: MessageEvent) => {
      const data = event.data;
      switch (data.kind) {
        case "output": {
          const audioBlobUrl = URL.createObjectURL(data.file);
          resolve({ file: audioBlobUrl, duration: data.duration });
          worker?.removeEventListener("message", msgHandler);
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
        case "complete": {
             // Piper worker sends 'complete' after 'output'.
             // We resolved on 'output'.
             break;
        }
      }
    };

    worker.addEventListener("message", msgHandler);

    worker.postMessage({
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
    });
  });
};
