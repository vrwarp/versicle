/**
 * Per-book AI consent resolver (Phase 7 §H / PR-N3, privacy D2) — the
 * policy the NetworkGateway consent gate consults for `consent: 'per-book'`
 * destinations (gemini) on NON-interactive calls.
 *
 * Resolution order (pure; deps injected so the policy is unit-testable):
 *  1. explicit per-book bit from synced preferences (false ⇒ DENY — the
 *     egress is blocked with NET_CONSENT_REQUIRED before any bytes leave),
 *  2. grandfathering: books with existing contentAnalysis records keep
 *     working without new prompts (the prep doc's derivation rule),
 *  3. observe-mode allow: the global isEnabled/feature flags remain the
 *     effective gate. Two reasons this is not yet a default-deny:
 *     - the consent PROMPT ("ask on first TTS play") lives in the TTS UI
 *       owned by the parallel 5b/5c chain — denying without an affordance
 *       to grant would silently kill analysis for every new book;
 *     - the TTS pipeline's EngineContext port does not thread bookId yet
 *       (P5c narrows it), so most non-interactive calls arrive without a
 *       bookId anyway (step 0 below).
 *  0. calls without a bookId are allowed (legacy posture, documented).
 */
import type { ConsentResolver } from '@kernel/net';

export interface AiConsentDeps {
  /** Explicit per-book bit (usePreferencesStore.aiConsent). */
  getConsent: (bookId: string) => boolean | undefined;
  /** True when the book already has synced contentAnalysis records. */
  hasAnalysisRecords: (bookId: string) => boolean;
}

export function makeAiConsentResolver(deps: AiConsentDeps): ConsentResolver {
  return (_destination, consent) => {
    // Belt-and-braces: the gateway already bypasses interactive calls.
    if (consent.interactive === true) return true;
    const bookId = consent.bookId;
    if (!bookId) return true;
    const explicit = deps.getConsent(bookId);
    if (explicit !== undefined) return explicit;
    if (deps.hasAnalysisRecords(bookId)) return true;
    return true;
  };
}
