/**
 * The per-book AI consent PROMPT — the "ask on first TTS play" affordance
 * the Phase 7 §Follow-ups (item 3) deferred to the TTS UI and P9 lands.
 *
 * The companion of app/google/aiConsent.ts (the gateway-side RESOLVER):
 * with this prompt in place, the resolver leaves observe-mode for
 * bookId-carrying calls — an un-consented book is DENIED at the egress
 * boundary, and this dialog is how a user grants (or refuses) before the
 * TTS pipeline's non-interactive GenAI analysis (reference detection,
 * table narration) would run.
 *
 * Resolution short-circuits (no dialog) when:
 *  - GenAI is disabled or unconfigured (nothing would call the model),
 *  - the book already carries an explicit bit (asked before),
 *  - the book has synced contentAnalysis records (grandfathered — the
 *    aiConsent.ts derivation rule; pre-consent books keep working).
 *
 * The answer is persisted to the synced per-device preferences
 * (usePreferencesStore.aiConsent[bookId]) — both grants AND refusals, so a
 * book is asked exactly once. A refusal never blocks playback; it only
 * keeps the book's text on-device (analysis features skip). Surfacing the
 * stored bits for later editing is a settings follow-up (recorded at the
 * P9 close); until then a refusal can be revisited by toggling the global
 * AI enablement off/on only insofar as new books are concerned.
 */
import { confirmDialog } from '@components/ui/ConfirmDialog';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { useGenAIStore } from '@store/useGenAIStore';
import { useContentAnalysisStore } from '@store/useContentAnalysisStore';
import { genAIIsConfigured } from '@app/tts/genaiPort';
import { createLogger } from '@lib/logger';

const logger = createLogger('aiConsentPrompt');

/** One in-flight dialog per book — double play() must not stack prompts. */
const promptInFlight = new Set<string>();

export async function ensureAiConsentForBook(bookId: string | null): Promise<void> {
  if (!bookId) return;

  const genai = useGenAIStore.getState();
  if (!genai.isEnabled) return;
  try {
    if (!genAIIsConfigured()) return;
  } catch {
    return; // unconfigurable client ⇒ nothing will reach the model
  }

  const prefs = usePreferencesStore.getState();
  if (prefs.aiConsent[bookId] !== undefined) return;

  // Grandfathering (aiConsent.ts derivation rule): existing analysis
  // records mean the resolver allows this book without a new prompt.
  const hasRecords = Object.keys(useContentAnalysisStore.getState().sections).some(
    (key) => key.startsWith(`${bookId}/`)
  );
  if (hasRecords) return;

  if (promptInFlight.has(bookId)) return;
  promptInFlight.add(bookId);
  try {
    const granted = await confirmDialog({
      titleKey: 'genai.consent.title',
      bodyKey: 'genai.consent.body',
      confirmKey: 'genai.consent.allow',
      cancelKey: 'genai.consent.deny',
    });
    usePreferencesStore.getState().setAiConsent(bookId, granted);
    logger.info(`AI consent for ${bookId}: ${granted ? 'granted' : 'denied'}`);
  } finally {
    promptInFlight.delete(bookId);
  }
}
