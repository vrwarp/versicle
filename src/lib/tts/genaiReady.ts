/**
 * ensureGenAIReady — the ONE GenAI availability/configuration gate for the
 * TTS content pipeline (Phase 5c; phase5-tts-strangler.md §5c.2). Replaces
 * the duplicated `canUseGenAI` + `'gemini-1.5-flash'` fallback blocks in
 * AudioContentPipeline and TableAdaptationProcessor.
 *
 * The `mockGenAIResponse` localStorage seam this module used to honor died
 * at the Phase 7 merge (GG-4/privacy D9): nothing sets the key anymore —
 * E2E/dev mocks install a MockGenAIClient at the composition root via
 * `window.__versicleTest.genai.setMock(...)` (src/test-api.ts), and the
 * port's isConfigured() reflects it transparently.
 *
 * Post-P7 note: the production port's configure() is a documented no-op
 * (config is read per call from the composition-root provider — GG-8), so
 * the configure branch below only matters for injected fakes; it stays
 * until the EngineContext GenAI port is narrowed (P7 follow-up).
 */
import type { GenAIPort } from './engine/EngineContext';

/** The model id used when a key exists but the client was never configured. */
const FALLBACK_MODEL = 'gemini-1.5-flash';

/**
 * Returns true when the GenAI client is enabled and configured (configuring
 * it from the stored API key if necessary). Callers proceed with model calls
 * only on `true`.
 */
export async function ensureGenAIReady(genAI: GenAIPort): Promise<boolean> {
    const settings = genAI.getSettings();
    if (!settings.isEnabled) return false;

    const configured = await genAI.isConfigured();
    if (!configured && !settings.apiKey) return false;

    if (!configured && settings.apiKey) {
        genAI.configure(settings.apiKey, FALLBACK_MODEL);
    }

    return await genAI.isConfigured();
}
