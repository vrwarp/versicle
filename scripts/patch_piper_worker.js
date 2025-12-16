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

// Patch 1: Add config to phonemize call
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

// Patch 2: Sanitize phonemeIds
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

if (modified) {
    fs.writeFileSync(workerPath, content, 'utf8');
    console.log('piper_worker.js updated.');
} else {
    console.log('No changes made to piper_worker.js.');
}
