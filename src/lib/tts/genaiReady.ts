/**
 * ensureGenAIReady — the single GenAI availability/configuration gate for the
 * TTS content pipeline. Callers (AudioContentPipeline, TableAdaptationProcessor)
 * route through it instead of each repeating their own enabled-check plus
 * fallback-model wiring.
 *
 * Test/dev mocks no longer go through any localStorage seam: they install a
 * MockGenAIClient at the composition root via
 * `window.__versicleTest.genai.setMock(...)` (src/test-api.ts), and the port's
 * isConfigured() reflects that transparently.
 *
 * In production the port's configure() is a deliberate no-op: real config is
 * read fresh per call from the composition-root provider, so the configure()
 * branch below only does anything for injected fakes. It stays until the
 * EngineContext GenAI port is narrowed.
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
