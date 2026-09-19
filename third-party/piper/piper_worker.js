// worker_blob_cache.js
var getBlob = async (url, blobs) => new Promise((resolve) => {
  const cached = blobs[url];
  if (cached)
    return resolve(cached);
  const id = new Date().getTime();
  let xContentLength;
  self.postMessage({ kind: "fetch", id, url });
  const xhr = new XMLHttpRequest;
  xhr.responseType = "blob";
  xhr.onprogress = (event) => self.postMessage({
    kind: "fetch",
    id,
    url,
    total: xContentLength ?? event.total,
    loaded: event.loaded
  });
  xhr.onreadystatechange = () => {
    if (xhr.readyState >= xhr.HEADERS_RECEIVED && xContentLength === undefined && xhr.getAllResponseHeaders().includes("x-content-length"))
      xContentLength = Number(xhr.getResponseHeader("x-content-length"));
    if (xhr.readyState === xhr.DONE) {
      self.postMessage({ kind: "fetch", id, url, blob: xhr.response });
      resolve(xhr.response);
    }
  };
  xhr.open("GET", url);
  xhr.send();
});

// piper_worker.js
// Global error handlers
self.onerror = function(message, source, lineno, colno, error) {
    self.postMessage({
        kind: 'error',
        error: error ? error.toString() : message,
        stack: error ? error.stack : null
    });
};

self.onunhandledrejection = function(event) {
    self.postMessage({
        kind: 'error',
        error: event.reason ? event.reason.toString() : 'Unhandled Rejection',
        stack: event.reason ? event.reason.stack : null
    });
};
// Versicle patch 8: per-worker object-URL cache + one-shot importScripts.
// `init` runs ONCE PER SYNTHESIZED CHUNK (PiperRuntime posts one {kind:"init"} per
// generate()), and every run used to mint a FRESH object URL for each cached blob — four
// blob-URL registry entries leaked per sentence, each pinning its blob for the worker's
// lifetime — and re-imported piper_phonemize.js (120 KB) + ort.min.js (540 KB) each time,
// re-parsing ~660 KB of JavaScript per sentence. Both are per-worker constants.
var urlCache = {};
async function assetUrl(url, blobs) {
  if (!urlCache[url]) {
    urlCache[url] = URL.createObjectURL(await getBlob(url, blobs));
  }
  return urlCache[url];
}
async function phonemize(data, onnxruntimeBase, modelConfig) {
  const { input, speakerId, blobs, modelUrl, modelConfigUrl } = data;
  const piperPhonemizeJs = await assetUrl(data.piperPhonemizeJsUrl, blobs);
  const piperPhonemizeWasm = await assetUrl(data.piperPhonemizeWasmUrl, blobs);
  const piperPhonemizeData = await assetUrl(data.piperPhonemizeDataUrl, blobs);
  // Versicle patch 8: createPiperPhonemize is a worker global once imported.
  if (typeof createPiperPhonemize === "undefined") importScripts(piperPhonemizeJs);
  const phonemeIds = await new Promise(async (resolve) => {
    const module = await createPiperPhonemize({
      print: (data2) => {
        resolve(JSON.parse(data2).phoneme_ids);
      },
      printErr: (message) => {
        self.postMessage({ kind: "stderr", message });
      },
      locateFile: (url, _scriptDirectory) => {
        if (url.endsWith(".wasm"))
          return piperPhonemizeWasm;
        if (url.endsWith(".data"))
          return piperPhonemizeData;
        return url;
      }
    });
    module.FS.createDataFile(
      "/",
      "config.json",
      JSON.stringify(modelConfig),
      true,
      true,
      true
    );
    module.callMain([
      "-l",
      modelConfig.espeak.voice,
      "--input",
      JSON.stringify([{ text: input }]),
      "--espeak_data",
      "/espeak-ng-data",
      "--config",
      "/config.json"
    ]);
  });
  return phonemeIds;
}
async function init(data, phonemizeOnly = false) {
  // Request-id envelope (Versicle 5a-PR3): every terminal message for this request
  // carries data.requestId so the main thread can drop stale/cross-talk replies.
  const requestId = data.requestId;
  try {
  const { input, speakerId, blobs, modelUrl, modelConfigUrl, onnxruntimeUrl } = data;
  const modelConfigBlob = await getBlob(modelConfigUrl, blobs);
  const modelConfig = JSON.parse(await modelConfigBlob.text());
  const onnxruntimeBase = onnxruntimeUrl;
  const providedPhonemeIds = data.phonemeIds;
  let phonemeIds = providedPhonemeIds ?? await phonemize(data, onnxruntimeBase, modelConfig);
  if (modelConfig.num_symbols) {
    const maxId = modelConfig.num_symbols - 1;
    for (let i = 0; i < phonemeIds.length; i++) {
      if (phonemeIds[i] > maxId) {
        console.warn('Phoneme ID ' + phonemeIds[i] + ' out of bounds (max ' + maxId + '). Replacing with 0.');
        phonemeIds[i] = 0;
      }
    }
  }
  const phonemeIdMap = Object.entries(modelConfig.phoneme_id_map);
  const idPhonemeMap = Object.fromEntries(phonemeIdMap.map(([k, v]) => [v[0], k]));
  const phonemes = phonemeIds.map((id) => idPhonemeMap[id]);
  if (phonemizeOnly) {
    self.postMessage({ kind: "output", requestId, input, phonemes, phonemeIds });
    self.postMessage({ kind: "complete", requestId });
    return;
  }
  const onnxruntimeJs = await assetUrl(`${onnxruntimeBase}ort.min.js`, blobs);
  // Versicle patch 8: ort is a worker global once imported.
  if (typeof ort === "undefined") importScripts(onnxruntimeJs);
  ort.env.wasm.numThreads = navigator.hardwareConcurrency;
  ort.env.wasm.wasmPaths = onnxruntimeBase;
  const sampleRate = modelConfig.audio.sample_rate;
  const numChannels = 1;
  const noiseScale = modelConfig.inference.noise_scale;
  const lengthScale = modelConfig.inference.length_scale;
  const noiseW = modelConfig.inference.noise_w;
  const modelBlob = await getBlob(modelUrl, blobs);
  let session = cachedSession[modelUrl];
  if (!session) {
    // Versicle patch 8: ort fetches this URL exactly once inside create() and copies the
    // bytes into the WASM heap (ort.min.js `createInferenceSessionHandler(path)`), so the
    // URL is revoked as soon as the session exists — leaving it registered pinned the whole
    // model blob in the worker for its lifetime.
    const modelObjectUrl = URL.createObjectURL(modelBlob);
    try {
      session = await ort.InferenceSession.create(modelObjectUrl);
    } finally {
      URL.revokeObjectURL(modelObjectUrl);
    }
    if (Object.keys(cachedSession).length) {
      // Versicle patch 8: a superseded session holds its model weights in the ort WASM
      // heap; dropping the reference alone never frees them. release() does.
      for (const key of Object.keys(cachedSession)) {
        try {
          await cachedSession[key].release();
        } catch (err) {
          console.warn("Failed to release ONNX session", err);
        }
      }
      cachedSession = {};
    }
  }
  cachedSession[modelUrl] = session;
  const feeds = {
    input: new ort.Tensor("int64", phonemeIds, [1, phonemeIds.length]),
    input_lengths: new ort.Tensor("int64", [phonemeIds.length]),
    scales: new ort.Tensor("float32", [noiseScale, lengthScale, noiseW])
  };
  if (Object.keys(modelConfig.speaker_id_map).length)
    feeds.sid = new ort.Tensor("int64", [speakerId]);
  const {
    output: { data: pcm }
  } = await session.run(feeds);
      /**
       * Converts PCM audio data to a WAV file format.
       *
       * WAV File Specification (RIFF):
       * - Chunk ID (4 bytes): "RIFF" (0x52494646)
       * - Chunk Size (4 bytes): 36 + SubChunk2Size
       * - Format (4 bytes): "WAVE" (0x57415645)
       * - Subchunk1 ID (4 bytes): "fmt " (0x666d7420)
       * - Subchunk1 Size (4 bytes): 16 (PCM)
       * - AudioFormat (2 bytes): 1 (Linear PCM)
       * - NumChannels (2 bytes): 1 or 2
       * - SampleRate (4 bytes)
       * - ByteRate (4 bytes): SampleRate * NumChannels * BitsPerSample/8
       * - BlockAlign (2 bytes): NumChannels * BitsPerSample/8
       * - BitsPerSample (2 bytes): 16
       * - Subchunk2 ID (4 bytes): "data" (0x64617461)
       * - Subchunk2 Size (4 bytes): NumSamples * NumChannels * BitsPerSample/8
       */
      function PCM2WAV(buffer, sampleRate2, numChannels2) {
    const bufferLength = buffer.length;
    const headerLength = 44;
    const view = new DataView(new ArrayBuffer(bufferLength * numChannels2 * 2 + headerLength));
    view.setUint32(0, 1179011410, true);
    view.setUint32(4, view.buffer.byteLength - 8, true);
    view.setUint32(8, 1163280727, true);
    view.setUint32(12, 544501094, true);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels2, true);
    view.setUint32(24, sampleRate2, true);
    view.setUint32(28, numChannels2 * 2 * sampleRate2, true);
    view.setUint16(32, numChannels2 * 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(36, 1635017060, true);
    view.setUint32(40, 2 * bufferLength, true);
    let p = headerLength;
    for (let i = 0;i < bufferLength; i++) {
      const v = buffer[i];
      if (v >= 1)
        view.setInt16(p, 32767, true);
      else if (v <= -1)
        view.setInt16(p, -32768, true);
      else
        view.setInt16(p, v * 32768 | 0, true);
      p += 2;
    }
    const wavBuffer = view.buffer;
    const duration2 = bufferLength / (sampleRate2 * numChannels2);
    return { wavBuffer, duration: duration2 };
  }
  const result = PCM2WAV(pcm, sampleRate, numChannels);
  const file = new Blob([result.wavBuffer], { type: "audio/x-wav" });
  const duration = Math.floor(result.duration * 1000);
  self.postMessage({
    kind: "output",
    requestId,
    input,
    file,
    duration,
    phonemes,
    phonemeIds
  });
  self.postMessage({ kind: "complete", requestId });
  } catch (err) {
      self.postMessage({ kind: 'error', requestId, error: err.toString() });
  }
}
var cachedSession = {};
self.addEventListener("message", (event) => {
  try {
      const data = event.data;
      if (data.kind === "init")
        init(data);
      if (data.kind === "isAlive")
        isAlive(data.modelUrl);
      if (data.kind === "phonemize")
        init(data, true);
  } catch (err) {
      self.postMessage({ kind: 'error', error: err.toString() });
  }
});
var isAlive = (modelUrl) => {
  self.postMessage({
    kind: "isAlive",
    isAlive: cachedSession[modelUrl] != null
  });
};
