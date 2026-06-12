/**
 * CSP rendering — the Content-Security-Policy is GENERATED from the egress
 * destination registry (Phase 7 §I). One renderer feeds every copy:
 *
 *  - nginx.conf            scripts/generate-csp.mjs (committed output)
 *  - vite preview headers  vite.config.ts imports renderCsp()
 *  - index.html meta       vite.config.ts injects it at BUILD time (covers
 *                          the Capacitor Android WebView, which had NO CSP
 *                          at all before this — privacy report D4). It is
 *                          not committed into index.html source because the
 *                          dev server needs the HMR websocket (ws:) which a
 *                          committed meta would block.
 *
 * The ./csp.test.ts registry==CSP test pins: every registry host appears in
 * the rendered connect-src AND the committed nginx.conf carries exactly the
 * rendered policy. Editing the registry without regenerating fails CI.
 *
 * STRICTNESS NOTE (deliberate, per the prep doc's PR-N1/P8 split): the
 * rendered connect-src still contains the legacy `https:` scheme wildcard,
 * so this policy ENUMERATES the registry without yet ENFORCING it. The
 * strict flip (dropping `https:` from connect-src and img-src) is Phase 8's
 * call, after Piper offline behavior is verified — flipping early would
 * break Drive/Firebase/HF for users mid-rollout (privacy report migration
 * note: "Do CSP last").
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
  ['img-src', "'self' data: blob: https:"],
  ['font-src', "'self' data:"],
];

/** The registry-derived connect-src source list (hosts sorted for stability). */
export function connectSrcSources(): string[] {
  return [
    "'self'",
    // Legacy scheme wildcard — dropped at the P8 strict flip (see header).
    'https:',
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
