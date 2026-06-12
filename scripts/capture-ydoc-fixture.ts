#!/usr/bin/env node
/**
 * Y.Doc fixture capture (plan/overhaul/prep/phase2-fork-surgery.md §4.2).
 *
 * Builds era-shaped Y.Doc snapshots from the shared seed dataset
 * (src/test/fixtures/ydoc/seed.ts) and writes:
 *
 *   src/test/fixtures/ydoc/v{1,2,4,5}.update.bin   (Y update encoding)
 *   src/test/fixtures/ydoc/manifest.json           (era, method, sha256, …)
 *
 * Run manually (Node ≥25 runs TypeScript directly):
 *
 *   node scripts/capture-ydoc-fixture.ts            # all eras
 *   node scripts/capture-ydoc-fixture.ts --era v4   # one era
 *
 * Outputs are CHECKED IN AND REVIEWED, never regenerated in CI — a vitest
 * guard (src/store/__tests__/crdt-contract/fixtures-manifest.test.ts) pins
 * manifest↔file sha256 agreement so fixtures cannot drift silently. See
 * src/test/fixtures/ydoc/README.md for provenance and the higher-fidelity
 * regeneration procedures (historical git worktree / real-device import).
 *
 * Method notes (recorded per fixture in the manifest):
 *  - v4/v5 ("writer-current-mapping"): plain-string encoding via the vendored
 *    middleware's own objectToYMap with { disableYText: true } — the exact
 *    mapping code v4+ clients write with, so fidelity is full.
 *  - v1/v2 ("writer-ytext-fallback"): Y.Text encoding via the same mapping
 *    with default options (strings → Y.Text), built with the CURRENT yjs
 *    library. This is the design doc's documented fallback: lower fidelity
 *    than capturing through a historical worktree (item encodings are
 *    current-yjs, not era-yjs), flagged in the manifest. The Y.Text values
 *    themselves are real Y.Text items, which is what the middleware's
 *    repair path (contract case A.9) actually branches on.
 *
 * Determinism: fixed doc GUID + clientID per era and a single transaction,
 * so re-running the script produces byte-identical files (the manifest's
 * capturedAt field is refreshed only when the bytes change).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { objectToYMap } from '../packages/zustand-middleware-yjs/src/mapping.ts';
import { seedFor, FIXTURE_ERAS, type FixtureEra } from '../src/test/fixtures/ydoc/seed.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = join(repoRoot, 'src', 'test', 'fixtures', 'ydoc');
const manifestPath = join(fixtureDir, 'manifest.json');

const eraArgIndex = process.argv.indexOf('--era');
const onlyEra: FixtureEra | undefined =
  eraArgIndex === -1
    ? undefined
    : (Number(process.argv[eraArgIndex + 1]?.replace(/^v/, '')) as FixtureEra);

const buildDoc = (era: FixtureEra): Y.Doc => {
  const doc = new Y.Doc({ guid: `versicle-fixture-v${era}` });
  // Fixed clientID → identical struct encoding on every run.
  doc.clientID = 100 + era;

  // v4 flipped disableYText on globally (commit fb96dd97): v4+ docs carry
  // plain strings, pre-v4 docs carry Y.Text values.
  const mappingOptions = era >= 4 ? { disableYText: true } : {};
  const seed = seedFor(era);

  doc.transact(() => {
    for (const [mapName, content] of Object.entries(seed.maps)) {
      const map = doc.getMap(mapName);
      // Top-level entries get the same per-value mapping the middleware's
      // patchSharedType INSERT branch applies.
      for (const [key, value] of Object.entries(content)) {
        if (value === null || typeof value !== 'object') {
          if (typeof value === 'string' && !('disableYText' in mappingOptions)) {
            map.set(key, new Y.Text(value));
          } else {
            map.set(key, value);
          }
        } else if (Array.isArray(value)) {
          // No top-level arrays in the seed today; route through a wrapper
          // map for consistency if one ever appears.
          map.set(key, objectToYMap({ [key]: value }, mappingOptions).get(key));
        } else {
          map.set(key, objectToYMap(value as Record<string, unknown>, mappingOptions));
        }
      }
    }
  });

  return doc;
};

const gitHead = (): string => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'UNKNOWN';
  }
};

interface ManifestEntry {
  era: number;
  file: string;
  sha256: string;
  method: 'writer-current-mapping' | 'writer-ytext-fallback';
  fidelityNote: string;
  generator: string;
  generatorSha: string;
  capturedAt: string;
  contentChecklist: string[];
}

const manifest: { $comment: string; fixtures: Record<string, ManifestEntry> } =
  existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : {
        $comment:
          'Captured Y.Doc fixtures (phase2-fork-surgery.md §4). Files are reviewed artifacts, never regenerated in CI; ' +
          'src/store/__tests__/crdt-contract/fixtures-manifest.test.ts pins sha256 agreement. See README.md.',
        fixtures: {},
      };

const eras = onlyEra ? [onlyEra] : [...FIXTURE_ERAS];
for (const era of eras) {
  if (!FIXTURE_ERAS.includes(era)) {
    console.error(`Unknown era "${String(era)}" — expected one of ${FIXTURE_ERAS.join(', ')}`);
    process.exit(1);
  }

  const doc = buildDoc(era);
  const update = Y.encodeStateAsUpdate(doc);
  const file = `v${era}.update.bin`;
  const outPath = join(fixtureDir, file);
  const sha256 = createHash('sha256').update(update).digest('hex');

  const previous = manifest.fixtures[`v${era}`];
  const unchanged =
    previous?.sha256 === sha256 && existsSync(outPath);

  writeFileSync(outPath, update);
  manifest.fixtures[`v${era}`] = {
    era,
    file,
    sha256,
    method: era >= 4 ? 'writer-current-mapping' : 'writer-ytext-fallback',
    fidelityNote:
      era >= 4
        ? 'Full fidelity: plain-JSON-into-Y-types via the vendored middleware mapping (v4+ encoding is exactly this).'
        : 'FALLBACK fidelity (§4.2): Y.Text-encoded with the CURRENT yjs library, not captured through a historical-era worktree. Y.Text items are real; era-specific struct layout is approximated. See README.md for the worktree procedure.',
    generator: 'scripts/capture-ydoc-fixture.ts',
    generatorSha: unchanged ? previous.generatorSha : gitHead(),
    capturedAt: unchanged ? previous.capturedAt : new Date().toISOString(),
    contentChecklist: [
      `library.__schemaVersion === ${era}`,
      'library.books: 2 books (one CJK title)',
      `progress: 2 devices${era === 1 ? ', one INVALID session (startTime: "corrupt")' : ', sessions valid'}`,
      `annotations: 2 annotations${era === 4 || era === 5 ? ' + stale top-level popover key' : ''}`,
      `preferences/<dev-a|dev-b>: scalar prefs${era >= 5 ? ' + fontProfiles' : ' WITHOUT fontProfiles'}${era >= 6 ? ` (husks) + folded preferences map + meta.schemaVersion=${era}` : ''}`,
      'reading-list.entries: 3, NONE carrying bookId (exact-filename match, fuzzy title+author match, orphan — the v8 linker inputs)',
      era >= 7
        ? 'vocabulary.knownCharacters: 3 CANONICAL simplified keys (the v7 output, duplicate pair min-merged); lexicon: 2 rules + 1 settings; contentAnalysis: 1 section (tableAdaptations); devices: 2'
        : era >= 6
          ? 'vocabulary.knownCharacters: 4 TRADITIONAL keys incl. the 紅/红 duplicate pair (v7 min-merge); lexicon: 2 rules + 1 settings; contentAnalysis: 1 section (tableAdaptations); devices: 2'
          : 'vocabulary.knownCharacters: 3; lexicon: 2 rules + 1 settings; contentAnalysis: 1 section (tableAdaptations); devices: 2',
      era >= 4 ? 'strings are plain (disableYText era)' : 'strings are Y.Text (pre-v4 era)',
    ],
  };

  console.log(`${unchanged ? 'unchanged' : 'captured '}  ${file}  sha256=${sha256.slice(0, 16)}…  (${update.byteLength} bytes)`);
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest: ${manifestPath}`);
