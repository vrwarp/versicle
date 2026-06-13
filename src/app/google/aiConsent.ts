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
 *  3. default-DENY (P9 — observe-mode exited for bookId-carrying calls):
 *     the "ask on first TTS play" prompt now exists
 *     (app/google/aiConsentPrompt.ts, wired into TtsController.play), and
 *     the EngineContext GenAI port threads bookId from both TTS analysis
 *     callers — so an unknown un-consented book is a book whose prompt was
 *     bypassed, and the egress boundary refuses it.
 *  0. calls without a bookId are allowed (legacy posture for the surfaces
 *     that still don't thread one — smart TOC / smart link, which are
 *     user-initiated anyway).
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
    // Default-deny (P9): the consent prompt is the affordance to grant.
    return false;
  };
}
