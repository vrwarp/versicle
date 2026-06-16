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
 *
 * Increment E §8.4.1 BACKGROUND GRANT PATH: the library-wide "Pre-embed my
 * library for semantic search" opt-in (default OFF, useGenAIStore.
 * preEmbedLibrary) IS the user's consent for BULK BACKGROUND embedding. A
 * background, bookId-carrying call (`consent.interactive !== true && bookId`)
 * is GRANTED when the opt-in is ON — checked BEFORE the per-book default-deny,
 * so an unread book that was never prompted can be backfilled. Without this the
 * per-book default-deny below would refuse every unread book and the bg lane
 * could never embed (the priv-1 dead-end). Foreground (interactive:true) is
 * short-circuited above; the opt-in does NOT widen any foreground grant.
 */
import type { ConsentResolver } from '@kernel/net';

export interface AiConsentDeps {
  /** Explicit per-book bit (usePreferencesStore.aiConsent). */
  getConsent: (bookId: string) => boolean | undefined;
  /** True when the book already has synced contentAnalysis records. */
  hasAnalysisRecords: (bookId: string) => boolean;
  /**
   * True when the library-wide background pre-embed opt-in is ON
   * (useGenAIStore.preEmbedLibrary) — the §8.4.1 background grant.
   */
  isLibraryPreEmbedEnabled: () => boolean;
}

export function makeAiConsentResolver(deps: AiConsentDeps): ConsentResolver {
  return (_destination, consent) => {
    // Belt-and-braces: the gateway already bypasses interactive calls.
    if (consent.interactive === true) return true;
    const bookId = consent.bookId;
    if (!bookId) return true;
    // §8.4.1 background grant: the library-wide opt-in is the user's consent for
    // bulk background embedding — granted BEFORE the per-book default-deny so an
    // un-prompted unread book can be backfilled. (interactive:true is already
    // short-circuited above, so this only ever grants BACKGROUND calls.)
    if (deps.isLibraryPreEmbedEnabled()) return true;
    const explicit = deps.getConsent(bookId);
    if (explicit !== undefined) return explicit;
    if (deps.hasAnalysisRecords(bookId)) return true;
    // Default-deny (P9): the consent prompt is the affordance to grant.
    return false;
  };
}
