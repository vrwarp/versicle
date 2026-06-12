/**
 * The registry==CSP invariant (Phase 7 §I, PR-N1 exit criterion — a
 * PERMANENT invariant from here on): the Content-Security-Policy is
 * generated from the egress destination registry, and every committed copy
 * carries exactly the generated policy. Editing the registry without
 * running `node scripts/generate-csp.mjs` fails this suite.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allRegistryHosts, EGRESS_DESTINATIONS } from './destinations';
import { connectSrcSources, parseCsp, renderCsp } from './csp';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('registry==CSP invariant', () => {
  it('every registry host (gateway AND sdk) appears in the rendered connect-src', () => {
    const connect = parseCsp(renderCsp()).get('connect-src') ?? [];
    for (const host of allRegistryHosts()) {
      expect(connect, `host ${host} missing from connect-src`).toContain(`https://${host}`);
    }
  });

  it('the rendered connect-src host set equals the registry host set exactly', () => {
    const rendered = connectSrcSources()
      .filter((s) => s.startsWith('https://'))
      .map((s) => s.slice('https://'.length))
      .sort();
    expect(rendered).toEqual(allRegistryHosts());
  });

  it('the committed nginx.conf carries exactly the rendered policy (all copies)', () => {
    const nginx = readFileSync(join(repoRoot, 'nginx.conf'), 'utf8');
    const matches = [...nginx.matchAll(/add_header Content-Security-Policy "([^"]*)";/g)].map(
      (m) => m[1],
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
    for (const policy of matches) {
      expect(policy).toBe(renderCsp());
    }
  });

  it('index.html source has NO meta CSP (build-time injection owns it — dev HMR needs ws:)', () => {
    const html = readFileSync(join(repoRoot, 'index.html'), 'utf8');
    expect(html).not.toContain('Content-Security-Policy');
  });

  it('registry hygiene: ids unique, hosts non-empty, no scheme in hosts', () => {
    const ids = EGRESS_DESTINATIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of EGRESS_DESTINATIONS) {
      expect(d.hosts.length).toBeGreaterThan(0);
      for (const h of d.hosts) {
        expect(h, `host ${h} of ${d.id} must not carry a scheme`).not.toMatch(/^[a-z]+:\/\//);
      }
    }
  });

  it('documents that no remote-code destination exists at HEAD (5a vendored onnxruntime)', () => {
    expect(EGRESS_DESTINATIONS.filter((d) => d.dataClass === 'remote-code')).toEqual([]);
  });
});
