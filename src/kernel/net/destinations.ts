/**
 * The egress destination registry — the single source of truth for "what
 * hosts may this app talk to" (Phase 7 §I, plan/overhaul/prep/
 * phase7-library-google.md; privacy report gap-privacy-posture-data-egress-ma
 * D1/D4 target design).
 *
 * Every network destination the app may contact is declared here with its
 * data classification, consent requirement, timeout, and offline policy.
 * Enforcement is three-layered:
 *
 *  1. `NetworkGateway.egress(destinationId, …)` (./NetworkGateway.ts) — every
 *     production fetch routes through it and is checked against this registry
 *     (raw `fetch` is lint-banned outside src/kernel/net — eslint.config.js).
 *  2. The CSP `connect-src` is GENERATED from this registry
 *     (./csp.ts + scripts/generate-csp.mjs → nginx.conf, vite preview
 *     headers, build-time index.html meta) — the four hand-maintained copies
 *     at HEAD are replaced by one renderer.
 *  3. The registry==CSP unit test (./csp.test.ts) is a permanent invariant:
 *     every gateway/sdk host below must appear in the generated connect-src.
 *
 * MODULE CONSTRAINTS (load-bearing):
 *  - NO imports. scripts/generate-csp.mjs imports this file directly under
 *    Node's type stripping; only fully erasable TypeScript syntax is allowed
 *    here (no enums, no namespaces, no parameter properties) and no path
 *    aliases (Node cannot resolve them).
 *  - kernel/ imports nothing internal (C12 admission rule); this module is
 *    the kernel-most point of the net layer.
 */

/** Stable destination ids. Append-only; ids appear in logs and tests. */
export type DestinationId =
  | 'gemini'
  | 'anthropic'
  | 'google-tts'
  | 'openai-tts'
  | 'lemonfox-tts'
  | 'hf-piper-catalog'
  | 'hf-piper-models'
  | 'drive'
  | 'google-oauth'
  | 'firebase';

/**
 * What kind of data flows to the destination (privacy report taxonomy):
 *  - 'book-content'  raw book text / page imagery leaves the device
 *  - 'book-derived'  data derived from books (annotations, analysis results)
 *  - 'metadata'      titles/filenames/listings, no book text
 *  - 'binary-asset'  opaque binaries (voice models, the user's own files)
 *  - 'auth'          OAuth flows / tokens
 *  - 'remote-code'   executable code (NONE at HEAD — Phase 5a vendored
 *                    onnxruntime; the cdnjs entry died with it)
 */
type EgressDataClass =
  | 'book-content'
  | 'book-derived'
  | 'metadata'
  | 'binary-asset'
  | 'auth'
  | 'remote-code';

/**
 * Consent gate the NetworkGateway applies:
 *  - 'none'                no gate (silent)
 *  - 'per-book'            the per-book aiConsent bit (synced preferences)
 *                          for NON-interactive calls; interactive calls pass
 *                          `consent: { interactive: true }`
 *  - 'per-action'          a user gesture triggers each call
 *  - 'oauth'               the OAuth consent screen is the gate
 *  - 'provider-selection'  choosing the provider in settings is the gate
 */
type EgressConsent =
  | 'none'
  | 'per-book'
  | 'per-action'
  | 'oauth'
  | 'provider-selection';

export interface EgressDestination {
  id: DestinationId;
  /**
   * Allowed hosts. Exact hostnames, plus CSP-style `*.` host wildcards
   * (no scheme wildcards). These feed the generated CSP connect-src.
   */
  hosts: readonly string[];
  /**
   * 'gateway' — calls route through NetworkGateway.egress().
   * 'sdk'     — an SDK/plugin owns the HTTP (firebase, @capgo social login):
   *             hosts feed the CSP but calls cannot route through egress().
   */
  via: 'gateway' | 'sdk';
  purpose: string;
  dataClass: EgressDataClass;
  consent: EgressConsent;
  /** Per-request timeout; null = abortable but unbounded (downloads). */
  timeoutMs: number | null;
  /**
   * 'fail'           offline ⇒ NET_OFFLINE immediately.
   * 'cache-fallback' offline ⇒ NET_OFFLINE too, but the CALLER contracts to
   *                  serve a cached copy (documented caller policy).
   */
  offline: 'fail' | 'cache-fallback';
  /**
   * Rate-limit governance. When present, NetworkGateway.egress() runs the
   * injected throttle on this `lane` before any bytes leave, rejecting requests
   * that exceed the provider's per-minute/per-day budget. Putting it on the
   * destination (rather than at each call site) makes throttling unbypassable,
   * just like the host-allowlist/offline/consent checks; the caller no longer
   * has to remember to ask. Absent ⇒ no throttling for this destination.
   *
   * NOTE: the lane union is spelled out here rather than imported from the
   * quota module because this file's "NO imports" rule (see top) feeds the
   * CSP-generator's Node type-stripping path, which cannot resolve path aliases.
   * It must stay in sync with the quota module's `Lane` type.
   */
  rateLimit?: { lane: 'fg' | 'bg' };
}

/**
 * The verified egress matrix (privacy report rows 1–12; rows 13–15 are not
 * fetch-mediated). NOTE Phase 5a already vendored onnxruntime + the piper
 * worker assets (`/piper/**` is same-origin), so the report's
 * `cdnjs-onnxruntime` remote-code entry does NOT exist at HEAD.
 *
 * The TTS provider call sites (google-tts/openai-tts/lemonfox-tts/hf-*) in
 * src/lib/tts/providers/** route through egress() since the Phase 7 merge
 * (the parallel-chain freeze that exempted them is over; the lint ban now
 * carries zero production exemptions outside src/kernel/net).
 */
export const EGRESS_DESTINATIONS: readonly EgressDestination[] = [
  {
    id: 'gemini',
    hosts: ['generativelanguage.googleapis.com'],
    via: 'gateway',
    purpose:
      'Gemini structured output: TOC titles, reference detection, table adaptations, library mapping',
    dataClass: 'book-content',
    consent: 'per-book',
    timeoutMs: 60_000,
    offline: 'fail',
    rateLimit: { lane: 'fg' },
  },
  {
    id: 'anthropic',
    hosts: ['api.anthropic.com'],
    via: 'gateway',
    purpose:
      'Claude (Anthropic) Messages API structured output: TOC titles, reference detection, table adaptations, library mapping (same features as the Gemini provider)',
    dataClass: 'book-content',
    consent: 'per-book',
    timeoutMs: 60_000,
    offline: 'fail',
    rateLimit: { lane: 'fg' },
  },
  {
    id: 'google-tts',
    hosts: ['texttospeech.googleapis.com'],
    via: 'gateway',
    purpose: 'Google Cloud TTS synthesis (full book text, sentence-by-sentence) + voice list',
    dataClass: 'book-content',
    consent: 'provider-selection',
    timeoutMs: 30_000,
    offline: 'fail',
    rateLimit: { lane: 'fg' },
  },
  {
    id: 'openai-tts',
    hosts: ['api.openai.com'],
    via: 'gateway',
    purpose: 'OpenAI TTS synthesis (full book text, sentence-by-sentence)',
    dataClass: 'book-content',
    consent: 'provider-selection',
    timeoutMs: 30_000,
    offline: 'fail',
    rateLimit: { lane: 'fg' },
  },
  {
    id: 'lemonfox-tts',
    hosts: ['api.lemonfox.ai'],
    via: 'gateway',
    purpose: 'LemonFox TTS synthesis (full book text, sentence-by-sentence)',
    dataClass: 'book-content',
    consent: 'provider-selection',
    timeoutMs: 30_000,
    offline: 'fail',
    rateLimit: { lane: 'fg' },
  },
  {
    id: 'hf-piper-catalog',
    hosts: ['huggingface.co'],
    via: 'gateway',
    purpose: 'Piper voices.json catalog (no book data; IP + usage pattern)',
    dataClass: 'metadata',
    consent: 'provider-selection',
    timeoutMs: 30_000,
    // Pairs with Phase 5a's voices.json caching: offline serves the cache.
    offline: 'cache-fallback',
  },
  {
    id: 'hf-piper-models',
    hosts: [
      'huggingface.co',
      // HF LFS download redirect targets.
      'cdn-lfs.huggingface.co',
      'cdn-lfs-us-1.huggingface.co',
    ],
    via: 'gateway',
    purpose: 'Piper voice model downloads (onnx + config blobs)',
    dataClass: 'binary-asset',
    consent: 'provider-selection',
    timeoutMs: null,
    offline: 'fail',
  },
  {
    id: 'drive',
    hosts: ['www.googleapis.com'],
    via: 'gateway',
    purpose: "Google Drive v3: folder/file listings + downloads of the user's own EPUBs",
    dataClass: 'binary-asset',
    consent: 'oauth',
    // Downloads are unbounded-but-abortable (privacy report D10).
    timeoutMs: null,
    offline: 'fail',
  },
  {
    id: 'google-oauth',
    hosts: ['accounts.google.com'],
    via: 'sdk', // @capgo/capacitor-social-login owns the flow
    purpose: 'Google OAuth login/logout/revoke (popup / native sheet)',
    dataClass: 'auth',
    consent: 'oauth',
    timeoutMs: null,
    offline: 'fail',
  },
  {
    id: 'firebase',
    // The user-configured BYO authDomain is NOT statically known (Risk #4 in
    // the prep doc): web deploys proxy it same-origin via /__/auth (nginx +
    // vite server proxy); a custom authDomain contacted directly is a
    // documented limitation of the generated CSP until the P8 strict flip.
    hosts: [
      'firestore.googleapis.com',
      'identitytoolkit.googleapis.com',
      'securetoken.googleapis.com',
      'www.googleapis.com',
      'firebasestorage.googleapis.com',
      '*.firebaseio.com',
    ],
    via: 'sdk', // firebase SDK owns the HTTP/WebChannel transport
    purpose:
      "Sync to the user's own Firebase project: Yjs doc (library inventory, progress, annotations incl. selected text), checkpoints, Cloud Storage snapshots, and — when 'Share AI caches across my devices' is ON — the AI-derived content-addressed full-book embedding cache (Cloud Storage embeddings/{key}.bin blobs + their Firestore embedCache/{key} HEAD docs)",
    dataClass: 'book-derived',
    consent: 'oauth',
    timeoutMs: null,
    offline: 'fail',
  },
];

/** Lookup by id; undefined for unknown ids (gateway throws a typed error). */
export function findDestination(id: string): EgressDestination | undefined {
  return EGRESS_DESTINATIONS.find((d) => d.id === id);
}

/** Every host the registry allows (gateway + sdk) — the CSP connect-src set. */
export function allRegistryHosts(): string[] {
  const hosts = new Set<string>();
  for (const d of EGRESS_DESTINATIONS) {
    for (const h of d.hosts) hosts.add(h);
  }
  return [...hosts].sort();
}

/** True when `host` matches `pattern` (exact, or `*.suffix` wildcard). */
export function hostMatches(host: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    return host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1;
  }
  return host === pattern;
}
