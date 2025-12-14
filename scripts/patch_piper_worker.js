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

// The code to replace
const search = `    module.callMain([
      "-l",
      modelConfig.espeak.voice,
      "--input",
      JSON.stringify([{ text: input }]),
      "--espeak_data",
      "/espeak-ng-data"
    ]);`;

const replace = `    module.FS.createDataFile(
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
    console.log('piper_worker.js already patched.');
} else {
    if (content.includes(search)) {
        content = content.replace(search, replace);
        fs.writeFileSync(workerPath, content, 'utf8');
        console.log('piper_worker.js patched successfully.');
    } else {
        console.error('Could not find code block to patch in piper_worker.js. Content might have changed.');
        // Debugging output
        // console.log('File content:', content);
        process.exit(1);
    }
}
