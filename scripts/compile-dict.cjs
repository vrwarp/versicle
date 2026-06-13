#!/usr/bin/env node
/**
 * CC-CEDICT compiler (Phase 6 §7.6, plan/overhaul/prep/phase6-reader-engine.md
 * PR-12) — provenance-preserving, fail-hard.
 *
 * Repairs over the legacy pipeline (gap report D5):
 *  - the silent 11-entry mock fallback on download failure is DELETED from
 *    the production path: any failure exits non-zero (the historical CI
 *    failure mode silently degraded the shipped dictionary). `--mock`
 *    writes ONLY to the test-fixture path and never touches public/.
 *  - the `#` header (license declaration + release metadata) is parsed and
 *    RETAINED as a sidecar, public/dict/cedict.meta.json — the shipped
 *    release is finally knowable (inventory.json references it).
 *  - the download is PINNED: scripts/cedict.lock.json records the source
 *    zip's sha256 + release date; a mismatch fails the build (MDBG rotates
 *    the export ~daily — upgrades are deliberate: `--update-lock`).
 *  - system `unzip` replaced by fflate (no shell deps; works on any CI).
 *
 * Outputs (git-ignored; built in CI and on dev bootstrap):
 *  - public/dict/cedict.json        word → [pinyin, definitions]
 *  - public/dict/cedict.meta.json   provenance sidecar
 *
 * Usage:
 *  node scripts/compile-dict.cjs                 # verify lock, compile
 *  node scripts/compile-dict.cjs --update-lock   # deliberate release upgrade
 *  node scripts/compile-dict.cjs --mock          # test fixture only
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { unzipSync } = require('fflate');

const COMPILER_VERSION = 2;
const ZIP_URL = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.zip';
const SOURCE_PAGE = 'https://www.mdbg.net/chinese/dictionary?page=cc-cedict';
const REPO_ROOT = path.join(__dirname, '..');
const LOCK_PATH = path.join(__dirname, 'cedict.lock.json');
const OUTPUT_DIR = path.join(REPO_ROOT, 'public/dict');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'cedict.json');
const META_PATH = path.join(OUTPUT_DIR, 'cedict.meta.json');
const MOCK_FIXTURE_PATH = path.join(REPO_ROOT, 'src/test/fixtures/dict/cedict.mock.json');

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function download(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
          response.resume();
          return;
        }
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      })
      .on('error', reject);
  });
}

/** The `#!`/`#` header → metadata; entry lines → the lookup table. */
function parse(content) {
  const lines = content.split(/\r?\n/);
  const header = {};
  const dict = {};
  let entryCount = 0;

  for (const line of lines) {
    if (line.startsWith('#')) {
      const directive = line.match(/^#!\s*([a-zA-Z]+)=(.*)$/);
      if (directive) header[directive[1]] = directive[2].trim();
      continue;
    }
    if (!line.trim()) continue;

    // CC-CEDICT format: Traditional Simplified [pinyin] /defn1/defn2/
    const match = line.match(/^([^\s]+)\s+([^\s]+)\s+\[([^\]]+)\]\s+\/(.+)\/$/);
    if (!match) continue;
    const trad = match[1];
    const simp = match[2];

    // Filter: Must contain at least 1 Chinese character
    if (!/[一-鿿]/.test(simp) && !/[一-鿿]/.test(trad)) {
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

  return { header, dict, entryCount };
}

function writeMockFixture() {
  // The rich offline mock — TEST FIXTURE ONLY (never the production path).
  const mockDict = {
    我: ['wǒ', 'I; me'],
    你: ['nǐ', 'you (singular)'],
    是: ['shì', 'is; am; are; yes; to be'],
    朋: ['péng', 'friend; companion'],
    友: ['yǒu', 'friend; companion'],
    朋友: ['péng you', 'friend; companion'],
    美: ['měi', 'beautiful; pretty; pleasing'],
    丽: ['lì', 'beautiful; pretty'],
    美丽: ['měi lì', 'beautiful; pretty'],
    们: ['men', 'plural marker for pronouns'],
    我们: ['wǒ men', 'we; us'],
  };
  fs.mkdirSync(path.dirname(MOCK_FIXTURE_PATH), { recursive: true });
  fs.writeFileSync(MOCK_FIXTURE_PATH, JSON.stringify(mockDict, null, 2) + '\n');
  console.log(`Mock dictionary fixture written to ${MOCK_FIXTURE_PATH}.`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--mock')) {
    writeMockFixture();
    return;
  }
  const updateLock = args.includes('--update-lock');

  if (!fs.existsSync(LOCK_PATH) && !updateLock) {
    throw new Error(
      `${LOCK_PATH} is missing. The download must be pinned: run ` +
        `'node scripts/compile-dict.cjs --update-lock' to record the current release.`,
    );
  }

  console.log(`Downloading CC-CEDICT from ${ZIP_URL}...`);
  const zip = await download(ZIP_URL);
  const zipSha = sha256(zip);

  if (updateLock) {
    console.log(`Pinning release sha256=${zipSha}.`);
  } else {
    const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
    if (lock.sha256 !== zipSha) {
      throw new Error(
        `CC-CEDICT release mismatch: downloaded sha256=${zipSha}, lock pins ${lock.sha256} ` +
          `(release ${lock.releaseDate}). MDBG rotated the export. Upgrading is a deliberate ` +
          `step: review and run 'node scripts/compile-dict.cjs --update-lock'.`,
      );
    }
  }

  console.log('Extracting archive (fflate)...');
  const files = unzipSync(new Uint8Array(zip));
  const u8 = files['cedict_ts.u8'];
  if (!u8) {
    throw new Error(`cedict_ts.u8 not found in the archive (entries: ${Object.keys(files).join(', ')}).`);
  }

  console.log('Parsing and optimizing entries...');
  const { header, dict, entryCount } = parse(Buffer.from(u8).toString('utf8'));
  if (entryCount < 10000) {
    throw new Error(`Parsed only ${entryCount} entries — the export looks truncated; refusing to ship it.`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const artifact = JSON.stringify(dict);
  fs.writeFileSync(OUTPUT_PATH, artifact);

  const meta = {
    name: 'CC-CEDICT (compiled)',
    sourceUrl: SOURCE_PAGE,
    downloadUrl: ZIP_URL,
    license: 'CC-BY-SA-4.0',
    licenseUrl: header.license || 'https://creativecommons.org/licenses/by-sa/4.0/',
    publisher: header.publisher || 'MDBG',
    releaseDate: header.date || 'UNKNOWN',
    sourceEntryCount: Number(header.entries) || entryCount,
    compiledEntryCount: entryCount,
    compiledKeyCount: Object.keys(dict).length,
    compilerVersion: COMPILER_VERSION,
    sourceZipSha256: zipSha,
    artifactSha256: sha256(Buffer.from(artifact)),
  };
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2) + '\n');

  if (updateLock) {
    fs.writeFileSync(
      LOCK_PATH,
      JSON.stringify(
        { url: ZIP_URL, sha256: zipSha, releaseDate: meta.releaseDate, entries: meta.sourceEntryCount },
        null,
        2,
      ) + '\n',
    );
    console.log(`Lock written to ${LOCK_PATH}.`);
  }

  console.log(
    `Compiled ${entryCount} entries (${meta.compiledKeyCount} keys) from release ${meta.releaseDate}.`,
  );
  console.log(`Artifact: ${OUTPUT_PATH}\nSidecar:  ${META_PATH}`);
}

main().catch((err) => {
  console.error('Pipeline failed:', err.message || err);
  process.exitCode = 1;
});
