/**
 * ensureGenAIReady — the ONE GenAI availability/configuration gate for the
 * TTS content pipeline (Phase 5c; phase5-tts-strangler.md §5c.2). Replaces
 * the duplicated `canUseGenAI` + `'gemini-1.5-flash'` fallback blocks in
 * AudioContentPipeline and TableAdaptationProcessor.
 *
 * The `mockGenAIResponse` localStorage seam is gated behind
 * `import.meta.env.DEV || VITE_E2E` here (it was reachable in production
 * builds before — content debt D8). Full MockGenAIClient-at-composition-root
 * replacement is Phase 7 scope.
 */
import type { GenAIPort } from './engine/EngineContext';

/** The model id used when a key exists but the client was never configured. */
const FALLBACK_MODEL = 'gemini-1.5-flash';

/** True when the E2E/DEV mock seam is active (never in production builds). */
export function isMockGenAISeamActive(): boolean {
    if (!(import.meta.env.DEV || import.meta.env.VITE_E2E)) return false;
    return typeof localStorage !== 'undefined' && !!localStorage.getItem('mockGenAIResponse');
}

/**
 * Returns true when the GenAI client is enabled and configured (configuring
 * it from the stored API key if necessary). Callers proceed with model calls
 * only on `true`.
 */
export async function ensureGenAIReady(genAI: GenAIPort): Promise<boolean> {
    const settings = genAI.getSettings();
    if (!settings.isEnabled) return false;

    const configured = await genAI.isConfigured();
    if (!configured && !settings.apiKey && !isMockGenAISeamActive()) return false;

    if (!configured && settings.apiKey) {
        genAI.configure(settings.apiKey, FALLBACK_MODEL);
    }

    return await genAI.isConfigured();
}
