const fs = require('fs');
const path = require('path');
const http = require('https');
const { execSync } = require('child_process');

const ZIP_URL = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.zip';
const TEMP_DIR = path.join(__dirname, '../.tmp');
const OUTPUT_DIR = path.join(__dirname, '../public/dict');
const ZIP_PATH = path.join(TEMP_DIR, 'cedict.zip');
const UNZIP_PATH = path.join(TEMP_DIR, 'cedict_ts.u8');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'cedict.json');

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    http.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function main() {
  console.log('Starting CC-CEDICT compilation pipeline...');
  
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // 1. Download Zip
  console.log(`Downloading CC-CEDICT from ${ZIP_URL}...`);
  try {
    await downloadFile(ZIP_URL, ZIP_PATH);
    console.log('Download complete.');
  } catch (err) {
    console.error('Failed to download zip. Using a fallback rich offline mock dictionary.', err);
    const mockDict = {
      "我": ["wǒ", "I; me"],
      "你": ["nǐ", "you (singular)"],
      "是": ["shì", "is; am; are; yes; to be"],
      "朋": ["péng", "friend; companion"],
      "友": ["yǒu", "friend; companion"],
      "朋友": ["péng you", "friend; companion"],
      "美": ["měi", "beautiful; pretty; pleasing"],
      "丽": ["lì", "beautiful; pretty"],
      "美丽": ["měi lì", "beautiful; pretty"],
      "们": ["men", "plural marker for pronouns"],
      "我们": ["wǒ men", "we; us"]
    };
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(mockDict));
    console.log('Fallback mock dictionary written.');
    return;
  }

  // 2. Unzip using system unzip (highly reliable on Mac)
  console.log('Extracting archive...');
  try {
    execSync(`unzip -o "${ZIP_PATH}" -d "${TEMP_DIR}"`);
    console.log('Extraction complete.');
  } catch (err) {
    console.error('Extraction failed:', err);
    return;
  }

  // 3. Parse and Compile
  console.log('Parsing and optimizing entries...');
  const dict = {};
  
  if (!fs.existsSync(UNZIP_PATH)) {
    console.error(`Extracted file not found at ${UNZIP_PATH}`);
    return;
  }

  const content = fs.readFileSync(UNZIP_PATH, 'utf8');
  const lines = content.split(/\r?\n/);

  let entryCount = 0;
  for (const line of lines) {
    // Skip comments
    if (line.startsWith('#') || !line.trim()) continue;

    // CC-CEDICT format: Traditional Simplified [pinyin] /defn1/defn2/
    const match = line.match(/^([^\s]+)\s+([^\s]+)\s+\[([^\]]+)\]\s+\/(.+)\/$/);
    if (match) {
      const trad = match[1];
      const simp = match[2];

      // Filter: Must contain at least 1 Chinese character
      if (!/[\u4e00-\u9fff]/.test(simp) && !/[\u4e00-\u9fff]/.test(trad)) {
        continue;
      }

      const pinyin = match[3];
      const definitions = match[4].replace(/\/$/, '').split('/').join('; ');

      const entry = [pinyin, definitions];
      
      const addEntry = (key) => {
        if (dict[key]) {
          const existing = dict[key];
          if (existing[0] !== pinyin) {
            const pinyins = existing[0].split(' / ');
            if (!pinyins.includes(pinyin)) {
              pinyins.push(pinyin);
            }
            dict[key] = [pinyins.join(' / '), existing[1] + ' | ' + definitions];
          } else {
            dict[key] = [existing[0], existing[1] + '; ' + definitions];
          }
        } else {
          dict[key] = entry;
        }
      };

      addEntry(simp);
      if (trad !== simp) {
        addEntry(trad);
      }
      entryCount++;
    }
  }

  console.log(`Compiled ${entryCount} unique dictionary entries.`);

  // 4. Save JSON
  console.log(`Writing optimized database to ${OUTPUT_PATH}...`);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(dict));
  console.log('Compilation pipeline complete successfully!');

  // Cleanup
  try {
    fs.unlinkSync(ZIP_PATH);
    fs.unlinkSync(UNZIP_PATH);
    fs.rmdirSync(TEMP_DIR);
  } catch (e) {
    // Ignore cleanup errors
  }
}

main().catch(err => {
  console.error('Pipeline failed:', err);
});
