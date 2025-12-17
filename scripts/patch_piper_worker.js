import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workerPath = path.resolve(__dirname, '../public/piper/piper_worker.js');

if (!fs.existsSync(workerPath)) {
  console.error(`File not found: ${workerPath}`);
  process.exit(1);
}

let content = fs.readFileSync(workerPath, 'utf8');
let modified = false;

// ---------------------------------------------------------------------------
// Patch 1: Add config to phonemize call
// ---------------------------------------------------------------------------
// Piper's phonemize function call signature requires passing the config path
// explicitly when using WASM. This patch ensures that the 'config.json' file
// is correctly created in the WASM filesystem and passed to the 'phonemize' call.

const searchConfig = `    module.callMain([
      "-l",
      modelConfig.espeak.voice,
      "--input",
      JSON.stringify([{ text: input }]),
      "--espeak_data",
      "/espeak-ng-data"
    ]);`;

const replaceConfig = `    module.FS.createDataFile(
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
    ]);`;

if (content.includes('"--config",')) {
    console.log('Config patch already applied.');
} else {
    if (content.includes(searchConfig)) {
        content = content.replace(searchConfig, replaceConfig);
        modified = true;
        console.log('Applied config patch.');
    } else {
        console.warn('Could not find code block for config patch. It might have changed or already be patched differently.');
    }
}

// ---------------------------------------------------------------------------
// Patch 2: Sanitize phonemeIds
// ---------------------------------------------------------------------------
// Sometimes the phonemize step returns phoneme IDs that are out of bounds for the
// model's vocabulary (num_symbols). This patch clamps or replaces invalid IDs
// to prevent the WASM inference engine from crashing with an out-of-bounds memory access.

const searchSanitize = `  const phonemeIds = providedPhonemeIds ?? await phonemize(data, onnxruntimeBase, modelConfig);`;
const replaceSanitize = `  let phonemeIds = providedPhonemeIds ?? await phonemize(data, onnxruntimeBase, modelConfig);
  if (modelConfig.num_symbols) {
    const maxId = modelConfig.num_symbols - 1;
    for (let i = 0; i < phonemeIds.length; i++) {
      if (phonemeIds[i] > maxId) {
        console.warn('Phoneme ID ' + phonemeIds[i] + ' out of bounds (max ' + maxId + '). Replacing with 0.');
        phonemeIds[i] = 0;
      }
    }
  }`;

if (content.includes('if (modelConfig.num_symbols) {')) {
    console.log('Sanitize patch already applied.');
} else {
    if (content.includes(searchSanitize)) {
        content = content.replace(searchSanitize, replaceSanitize);
        modified = true;
        console.log('Applied sanitize patch.');
    } else {
        console.error('Could not find code block for sanitize patch. Content might have changed.');
    }
}

// ---------------------------------------------------------------------------
// Patch 3: Global Error Handlers (Hardening Phase 1)
// ---------------------------------------------------------------------------
// Web Workers can fail silently. This patch adds global error handlers (onerror,
// onunhandledrejection) to catch any uncaught exceptions in the worker thread
// and post an explicit 'error' message back to the main thread.

const errorHandlers = `// Global error handlers
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
};`;

if (content.includes('// Global error handlers')) {
    console.log('Error handlers patch already applied.');
} else {
    // Insert after "piper_worker.js" comment or at the start of init code
    const target = '// piper_worker.js';
    if (content.includes(target)) {
        content = content.replace(target, target + '\n' + errorHandlers);
        modified = true;
        console.log('Applied global error handlers patch.');
    } else {
        // Fallback: prepend to file? Or look for another anchor.
        // If // piper_worker.js is missing (maybe concatenated file differs), try finding start of code.
        // Assuming the file structure from node_modules is stable.
        console.warn('Could not find // piper_worker.js marker. Trying to prepend error handlers.');
        content = errorHandlers + '\n' + content;
        modified = true;
    }
}

// ---------------------------------------------------------------------------
// Patch 4: PCM2WAV Documentation (Hardening Phase 1)
// ---------------------------------------------------------------------------
// Adds detailed JSDoc comments to the PCM2WAV function to explain the WAV
// header construction and magic numbers, improving maintainability.

const searchPCM2WAV = `  function PCM2WAV(buffer, sampleRate2, numChannels2) {`;
const replacePCM2WAV = `      /**
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
      function PCM2WAV(buffer, sampleRate2, numChannels2) {`;

if (content.includes('WAV File Specification (RIFF):')) {
    console.log('PCM2WAV docs patch already applied.');
} else {
    if (content.includes(searchPCM2WAV)) {
        content = content.replace(searchPCM2WAV, replacePCM2WAV);
        modified = true;
        console.log('Applied PCM2WAV docs patch.');
    } else {
        console.warn('Could not find PCM2WAV function definition.');
    }
}

// ---------------------------------------------------------------------------
// Patch 5: Add Try-Catch to worker listeners (Hardening Phase 1)
// ---------------------------------------------------------------------------
// Wraps the main message listener in a try-catch block to handle any synchronous
// errors during message processing.

const searchListener = `self.addEventListener("message", (event) => {
  const data = event.data;
  if (data.kind === "init")
    init(data);
  if (data.kind === "isAlive")
    isAlive(data.modelUrl);
  if (data.kind === "phonemize")
    init(data, true);
});`;

const replaceListener = `self.addEventListener("message", (event) => {
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
});`;

if (content.includes('try {')) {
     // Check if it's the specific try block we added?
     // init function usually has try/catch?
     // The original file doesn't seem to have try/catch in listener.
     if (content.includes('self.postMessage({ kind: \'error\', error: err.toString() });')) {
         console.log('Listener try-catch patch already applied.');
     } else {
         // Apply it
         if (content.includes(searchListener)) {
            content = content.replace(searchListener, replaceListener);
            modified = true;
            console.log('Applied listener try-catch patch.');
         }
     }
} else {
    if (content.includes(searchListener)) {
        content = content.replace(searchListener, replaceListener);
        modified = true;
        console.log('Applied listener try-catch patch.');
    }
}

// ---------------------------------------------------------------------------
// Patch 6: Wrap init in try-catch (Hardening Phase 1)
// ---------------------------------------------------------------------------
// Wraps the `init` function body in a try-catch block. Since `init` is async,
// this ensures that any asynchronous errors (rejections) during initialization
// or synthesis are caught and reported back to the main thread.

const searchInitStart = `async function init(data, phonemizeOnly = false) {`;
const replaceInitStart = `async function init(data, phonemizeOnly = false) {
  try {`;

// We also need to close the try catch at the end of init.
// This is hard with regex or string replace if we don't know the end exactly.
// However, the original file has `self.postMessage({ kind: "complete" });` at the end of init (and also early return).
// Actually, looking at original code:
// ...
//   self.postMessage({ kind: "complete" });
// }
// var cachedSession = {};

const searchInitEnd = `  self.postMessage({ kind: "complete" });
}`;

const replaceInitEnd = `  self.postMessage({ kind: "complete" });
  } catch (err) {
      self.postMessage({ kind: 'error', error: err.toString() });
  }
}`;

if (content.includes('async function init(data, phonemizeOnly = false) {\n  try {')) {
    console.log('Init try-catch patch already applied.');
} else {
    if (content.includes(searchInitStart) && content.includes(searchInitEnd)) {
        content = content.replace(searchInitStart, replaceInitStart);
        // Be careful with replaceInitEnd, it might match multiple times if other functions end similarly?
        // PCM2WAV is inside init, so it ends before init ends.
        // phonemize ends with `return phonemeIds; }`.
        // init ends with `self.postMessage({ kind: "complete" }); }`.

        // We need to replace the LAST occurrence of searchInitEnd inside init?
        // Or just replace `self.postMessage({ kind: "complete" });\n}` with the try-catch block.
        // This seems safe enough if that sequence is unique to init end.

        content = content.replace(searchInitEnd, replaceInitEnd);
        modified = true;
        console.log('Applied init try-catch patch.');
    } else {
         console.warn('Could not apply init try-catch patch. Signatures not found.');
    }
}


if (modified) {
    fs.writeFileSync(workerPath, content, 'utf8');
    console.log('piper_worker.js updated.');
} else {
    console.log('No changes made to piper_worker.js.');
}
