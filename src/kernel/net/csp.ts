/**
 * CSP rendering — the Content-Security-Policy is GENERATED from the egress
 * destination registry. One renderer feeds every copy:
 *
 *  - nginx.conf            scripts/generate-csp.mjs (committed output)
 *  - vite preview headers  vite.config.ts imports renderCsp()
 *  - index.html meta       vite.config.ts injects it at BUILD time (this is
 *                          what covers the Capacitor Android WebView). It is
 *                          not committed into index.html source because the
 *                          dev server needs the HMR websocket (ws:) which a
 *                          committed meta would block.
 *
 * The ./csp.test.ts registry==CSP test pins: every registry host appears in
 * the rendered connect-src AND the committed nginx.conf carries exactly the
 * rendered policy. Editing the registry without regenerating fails CI.
 *
 * STRICTNESS: there is no `https:` scheme wildcard in connect-src or
 * img-src, so the policy ENFORCES the registry: only enumerated hosts can be
 * contacted. This relies on (a) runtime caching, so Piper works offline, and
 * (b) the sanitizer stripping remote EPUB resources (src/lib/sanitizer.ts —
 * the functional replacement for `img-src https:`; tracking pixels die).
 * Known limitation (documented in README §Self-hosting): a BYO-Firebase
 * custom authDomain contacted DIRECTLY is not enumerable here — web
 * deploys proxy it same-origin via /__/auth (nginx + vite server proxy);
 * self-hosters changing the registry must run `npm run generate:csp`.
 *
 * MODULE CONSTRAINTS: imported by scripts/generate-csp.mjs under Node type
 * stripping — erasable syntax only, relative import WITH .ts extension, no
 * path aliases.
 */
import { allRegistryHosts } from './destinations.ts';

/** Directives that do not derive from the registry (carried over verbatim). */
const STATIC_DIRECTIVES: readonly (readonly [string, string])[] = [
  ['default-src', "'self'"],
  [
    'script-src',
    "'self' 'unsafe-inline' 'unsafe-eval' blob: https://apis.google.com https://*.firebaseapp.com",
  ],
  ['style-src', "'self' 'unsafe-inline' blob:"],
  // Strict: covers are blob:/SW-served same-origin; remote EPUB images are
  // stripped by the sanitizer (no tracking pixels).
  ['img-src', "'self' data: blob:"],
  ['font-src', "'self' data:"],
];

/** The registry-derived connect-src source list (hosts sorted for stability). */
export function connectSrcSources(): string[] {
  return [
    "'self'",
    // No `https:` scheme wildcard: every fetch destination must be in the
    // egress registry.
    'blob:',
    ...allRegistryHosts().map((h) => `https://${h}`),
  ];
}

/** Render the full policy string (the exact value of every CSP copy). */
export function renderCsp(): string {
  const directives: (readonly [string, string])[] = [
    ...STATIC_DIRECTIVES,
    ['connect-src', connectSrcSources().join(' ')],
  ];
  return directives.map(([name, value]) => `${name} ${value}`).join('; ') + ';';
}

/**
 * Parse a policy string into directive → source list. Exported for the
 * registry==CSP test (it parses the committed nginx.conf copy).
 */
export function parseCsp(policy: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    out.set(tokens[0], tokens.slice(1));
  }
  return out;
}
