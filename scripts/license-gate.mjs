#!/usr/bin/env node
/**
 * License gate (Phase 0; gap-third-party-licensing-provenan.md target design
 * step 3). Run as `npm run licenses:check`; CI-blocking in ci.yml.
 *
 * Fails when:
 *   1. Any PRODUCTION npm dependency (incl. transitive) has a license outside
 *      the GPL-3.0-compatible allowlist (third-party/license-allowlist.json)
 *      and no recorded name@version exception — so a newly added or
 *      relicensed dep (the ua-parser-js v2 AGPL surprise, in the other
 *      direction) is caught at PR time.
 *   2. Any third-party/inventory.json artifact is missing a required field
 *      (name, version, source, license, provenance) — provenance may be
 *      honestly "UNKNOWN — needs investigation", but never absent.
 *   3. THIRD-PARTY-NOTICES.md is missing (regenerate: npm run licenses:generate).
 *
 * Private packages are excluded from the npm scan: the root package and the
 * private-marked zustand-middleware-yjs fork, which is licensed via its
 * inventory.json entry instead.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const checker = require('license-checker-rseidelsohn');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const allowlistPath = join(repoRoot, 'third-party', 'license-allowlist.json');
const inventoryPath = join(repoRoot, 'third-party', 'inventory.json');
const noticesPath = join(repoRoot, 'THIRD-PARTY-NOTICES.md');

const { allowedLicenses, packageExceptions } = JSON.parse(
  readFileSync(allowlistPath, 'utf8'),
);
const allowed = new Set(allowedLicenses);
const failures = [];

// ---------------------------------------------------------------- inventory
const REQUIRED_FIELDS = ['name', 'version', 'source', 'license', 'provenance'];
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
if (!Array.isArray(inventory.artifacts) || inventory.artifacts.length === 0) {
  failures.push(`${inventoryPath}: "artifacts" must be a non-empty array`);
}
for (const [i, artifact] of (inventory.artifacts ?? []).entries()) {
  for (const field of REQUIRED_FIELDS) {
    const value = artifact[field];
    if (typeof value !== 'string' || value.trim() === '') {
      failures.push(
        `inventory.json artifacts[${i}] (${artifact.name ?? 'unnamed'}): missing required field "${field}"`,
      );
    }
  }
}
if (!inventory.licenseFloor?.license) {
  failures.push('inventory.json: missing licenseFloor.license (the GPL-3.0-or-later floor statement)');
}

// ------------------------------------------------------------------ notices
if (!existsSync(noticesPath)) {
  failures.push('THIRD-PARTY-NOTICES.md is missing — run `npm run licenses:generate` and commit it');
}

// ---------------------------------------------------- license expression eval
// Handles the shapes license-checker emits: "MIT", "MIT*" (guessed),
// "(MIT OR GPL-3.0-or-later)", "(MIT AND Zlib)", or an array of ids.
// OR: any branch allowed; AND: all parts allowed. No nested parens occur
// in practice; if they ever do, the expression simply fails the gate and
// gets handled via packageExceptions.
function licenseAllowed(expr) {
  if (Array.isArray(expr)) return expr.every((e) => licenseAllowed(e));
  const cleaned = String(expr).replace(/[()]/g, '').replace(/\*$/, '').trim();
  return cleaned
    .split(/\s+OR\s+/)
    .some((branch) => branch.split(/\s+AND\s+/).every((id) => allowed.has(id.trim())));
}

// ------------------------------------------------------- production npm deps
checker.init(
  { start: repoRoot, production: true, excludePrivatePackages: true },
  (err, packages) => {
    if (err) {
      console.error('license-checker failed:', err);
      process.exit(1);
    }

    const copyleftInfo = [];
    for (const [pkg, info] of Object.entries(packages)) {
      const license = info.licenses ?? 'UNKNOWN';
      if (packageExceptions[pkg]) continue; // manually verified, reason recorded
      if (!licenseAllowed(license)) {
        failures.push(
          `${pkg}: license "${license}" is not in the GPL-3.0-compatible allowlist ` +
            '(third-party/license-allowlist.json). Verify compatibility, then either ' +
            'extend allowedLicenses or add a name@version packageException with a reason.',
        );
      } else if (/(^|\s|\()(A?GPL|LGPL)-/i.test(String(license))) {
        copyleftInfo.push(`${pkg} (${license})`);
      }
    }

    if (copyleftInfo.length > 0) {
      console.log(
        `[info] copyleft production deps (combined work stays GPL-3.0-or-later):\n` +
          copyleftInfo.map((l) => `  - ${l}`).join('\n'),
      );
    }

    if (failures.length > 0) {
      console.error(`\nLicense gate FAILED (${failures.length} problem${failures.length === 1 ? '' : 's'}):`);
      for (const f of failures) console.error(`  ✗ ${f}`);
      process.exit(1);
    }

    console.log(
      `License gate OK: ${Object.entries(packages).length} production packages within allowlist; ` +
        `${inventory.artifacts.length} inventory artifacts complete; notices present.`,
    );
  },
);
