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

async function phonemize(data, onnxruntimeBase, modelConfig) {
  const { input, speakerId, blobs, modelUrl, modelConfigUrl } = data;
  const piperPhonemizeJs = URL.createObjectURL(await getBlob(data.piperPhonemizeJsUrl, blobs));
  const piperPhonemizeWasm = URL.createObjectURL(await getBlob(data.piperPhonemizeWasmUrl, blobs));
  const piperPhonemizeData = URL.createObjectURL(await getBlob(data.piperPhonemizeDataUrl, blobs));
  importScripts(piperPhonemizeJs);
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
        self.postMessage({ kind: "output", input, phonemes, phonemeIds });
        self.postMessage({ kind: "complete" });
        return;
      }
      const onnxruntimeJs = URL.createObjectURL(await getBlob(`${onnxruntimeBase}ort.min.js`, blobs));
      importScripts(onnxruntimeJs);
      ort.env.wasm.numThreads = navigator.hardwareConcurrency;
      ort.env.wasm.wasmPaths = onnxruntimeBase;
      const sampleRate = modelConfig.audio.sample_rate;
      const numChannels = 1;
      const noiseScale = modelConfig.inference.noise_scale;
      const lengthScale = modelConfig.inference.length_scale;
      const noiseW = modelConfig.inference.noise_w;
      const modelBlob = await getBlob(modelUrl, blobs);
      const session = cachedSession[modelUrl] ?? await ort.InferenceSession.create(URL.createObjectURL(modelBlob));
      if (Object.keys(cachedSession).length && !cachedSession[modelUrl])
        cachedSession = {};
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

        // RIFF chunk descriptor
        view.setUint32(0, 1179011410, true); // "RIFF"
        view.setUint32(4, view.buffer.byteLength - 8, true); // Chunk size
        view.setUint32(8, 1163280727, true); // "WAVE"

        // fmt sub-chunk
        view.setUint32(12, 544501094, true); // "fmt "
        view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
        view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
        view.setUint16(22, numChannels2, true); // NumChannels
        view.setUint32(24, sampleRate2, true); // SampleRate
        view.setUint32(28, numChannels2 * 2 * sampleRate2, true); // ByteRate
        view.setUint16(32, numChannels2 * 2, true); // BlockAlign
        view.setUint16(34, 16, true); // BitsPerSample (16 bits)

        // data sub-chunk
        view.setUint32(36, 1635017060, true); // "data"
        view.setUint32(40, 2 * bufferLength, true); // Subchunk2Size

        // Write PCM samples
        let p = headerLength;
        for (let i = 0; i < bufferLength; i++) {
          const v = buffer[i];
          // Clamp to 16-bit range and convert float to int16
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
        input,
        file,
        duration,
        phonemes,
        phonemeIds
      });
      self.postMessage({ kind: "complete" });
  } catch (err) {
      self.postMessage({ kind: 'error', error: err.toString() });
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
