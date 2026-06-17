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
 *  - the source snapshot is VENDORED in-repo (scripts/cedict-source.zip) and
 *    pinned (scripts/cedict.lock.json: sha256 + release date). Normal builds
 *    compile the committed snapshot OFFLINE and reproducibly — MDBG rotates
 *    its "latest" export ~daily, so pinning a checksum against that moving URL
 *    was inherently fragile (any cache-miss recompile would fail through no
 *    code change of ours). The only network access is the deliberate
 *    `--update-lock` upgrade, automated monthly behind a reviewed PR
 *    (.github/workflows/update-dict.yml).
 *  - system `unzip` replaced by fflate (no shell deps; works on any CI).
 *
 * Outputs (git-ignored; built in CI and on dev bootstrap):
 *  - public/dict/cedict.json        word → [pinyin, definitions]
 *  - public/dict/cedict.meta.json   provenance sidecar
 *
 * Usage:
 *  node scripts/compile-dict.cjs                 # compile vendored snapshot (offline)
 *  node scripts/compile-dict.cjs --update-lock   # fetch MDBG, re-vendor + re-pin
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
const VENDOR_PATH = path.join(__dirname, 'cedict-source.zip');
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

  let zip;
  if (updateLock) {
    // Deliberate upgrade — the ONLY path that touches the network: fetch
    // MDBG's current (daily-rotated) export, vendor it in-repo, re-pin below.
    console.log(`Downloading CC-CEDICT from ${ZIP_URL}...`);
    zip = await download(ZIP_URL);
    fs.writeFileSync(VENDOR_PATH, zip);
    console.log(`Vendored source written to ${VENDOR_PATH}.`);
  } else {
    // Normal build — compile the committed snapshot, fully offline. The
    // sha256 check below guards against corruption / lock drift, not a moving
    // upstream (we pin a vendored snapshot, never MDBG's rotating URL).
    if (!fs.existsSync(VENDOR_PATH)) {
      throw new Error(
        `${VENDOR_PATH} is missing — the pinned CC-CEDICT snapshot is vendored in-repo. ` +
          `Run 'node scripts/compile-dict.cjs --update-lock' to fetch and pin the current release.`,
      );
    }
    if (!fs.existsSync(LOCK_PATH)) {
      throw new Error(
        `${LOCK_PATH} is missing. Run 'node scripts/compile-dict.cjs --update-lock' to record the pin.`,
      );
    }
    zip = fs.readFileSync(VENDOR_PATH);
  }

  const zipSha = sha256(zip);
  if (updateLock) {
    console.log(`Pinning release sha256=${zipSha}.`);
  } else {
    const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
    if (lock.sha256 !== zipSha) {
      throw new Error(
        `Vendored CC-CEDICT integrity check failed: ${VENDOR_PATH} sha256=${zipSha}, ` +
          `lock pins ${lock.sha256} (release ${lock.releaseDate}). The vendored snapshot and ` +
          `lock are out of sync — re-run 'node scripts/compile-dict.cjs --update-lock'.`,
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
