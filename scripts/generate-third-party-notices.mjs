#!/usr/bin/env node
/**
 * Generates THIRD-PARTY-NOTICES.md (repo root) from:
 *   1. third-party/inventory.json — vendored / non-npm / runtime-fetched
 *      artifacts (fonts, dict, piper blobs, forks, patches, fixtures), and
 *   2. the PRODUCTION npm dependency tree (license-checker-rseidelsohn),
 *      with each package's copyright line where one is extractable.
 *
 * Run as `npm run licenses:generate` and commit the result whenever
 * production deps or the inventory change. The build today strips every
 * @license banner from dist chunks (gap report D1) — this file is the
 * notice-retention artifact for the repo/GitHub audience; emitting it into
 * dist/ (and driving the in-app credits UI from the same data) is a later
 * phase of the target design.
 *
 * Output is deterministic (sorted, no timestamps) so regeneration diffs
 * are reviewable.
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const checker = require('license-checker-rseidelsohn');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const inventory = require(join(repoRoot, 'third-party', 'inventory.json'));
const outPath = join(repoRoot, 'THIRD-PARTY-NOTICES.md');

checker.init(
  {
    start: repoRoot,
    production: true,
    excludePrivatePackages: true,
    customFormat: {
      licenses: '',
      repository: '',
      publisher: '',
      copyright: '',
    },
  },
  (err, packages) => {
    if (err) {
      console.error('license-checker failed:', err);
      process.exit(1);
    }

    const lines = [];
    lines.push('# Third-Party Notices');
    lines.push('');
    lines.push(
      '<!-- GENERATED FILE — do not edit by hand. Regenerate with `npm run licenses:generate`',
      '     (scripts/generate-third-party-notices.mjs). Inputs: third-party/inventory.json +',
      '     the production npm dependency tree. -->',
    );
    lines.push('');
    lines.push(
      'Versicle is licensed under **GPL-3.0-or-later** (see `LICENSE`). This is the',
      'license *floor* for the combined work, not a stylistic choice:',
      '`@jofr/capacitor-media-session` (GPL-3.0-or-later) and the espeak-ng code/data',
      'embedded in the shipped Piper WASM blobs (GPL-3.0) make any permissive',
      'relicensing a violation. `ua-parser-js` v2 (AGPL-3.0-or-later) additionally',
      'carries network-source obligations. Details: `third-party/inventory.json`.',
    );
    lines.push('');
    lines.push(
      'Versicle redistributes the third-party components below. Full license texts',
      'for npm packages ship inside each package (`node_modules/<name>/LICENSE`) and',
      'are not duplicated here.',
    );

    // ---------------------------------------------------------- inventory part
    lines.push('');
    lines.push('## Vendored, forked & non-npm artifacts');
    lines.push('');
    lines.push('From `third-party/inventory.json` (authoritative for provenance and modifications):');
    lines.push('');
    for (const a of inventory.artifacts) {
      lines.push(`### ${a.name}`);
      lines.push('');
      lines.push(`- **Version:** ${a.version}`);
      lines.push(`- **License:** ${a.license}`);
      lines.push(`- **Source:** ${a.source}`);
      if (a.path) lines.push(`- **Path:** ${a.path}`);
      lines.push(`- **Provenance:** ${a.provenance}`);
      if (a.modifications) lines.push(`- **Modifications:** ${a.modifications}`);
      if (a.notes) lines.push(`- **Notes:** ${a.notes}`);
      lines.push('');
    }

    // ----------------------------------------------------------- npm packages
    const byLicense = new Map();
    for (const [pkg, info] of Object.entries(packages)) {
      const license = Array.isArray(info.licenses)
        ? info.licenses.join(' / ')
        : String(info.licenses ?? 'UNKNOWN');
      if (!byLicense.has(license)) byLicense.set(license, []);
      byLicense.get(license).push({ pkg, ...info });
    }

    lines.push('## Bundled npm packages (production dependency tree)');
    lines.push('');
    lines.push(
      `${Object.keys(packages).length} packages, grouped by license. The private`,
      'fork `zustand-middleware-yjs` (MIT) is excluded from the scan and recorded',
      'in the inventory section above.',
    );
    lines.push('');
    const licenseIds = [...byLicense.keys()].sort((a, b) => a.localeCompare(b));
    for (const licenseId of licenseIds) {
      const pkgs = byLicense.get(licenseId).sort((a, b) => a.pkg.localeCompare(b.pkg));
      lines.push(`### ${licenseId} (${pkgs.length})`);
      lines.push('');
      for (const { pkg, repository, publisher, copyright } of pkgs) {
        const attribution = copyright || (publisher ? `Copyright ${publisher}` : '');
        const repo = repository ? ` — <${repository}>` : '';
        lines.push(`- \`${pkg}\`${attribution ? ` — ${attribution}` : ''}${repo}`);
      }
      lines.push('');
    }

    writeFileSync(outPath, lines.join('\n'));
    console.log(
      `Wrote ${outPath}: ${inventory.artifacts.length} inventory artifacts + ` +
        `${Object.keys(packages).length} npm packages across ${licenseIds.length} licenses.`,
    );
  },
);
