/**
 * The app-layer ProviderBuildContext source (Phase 5a-PR3 ctx-passing flip,
 * phase5-tts-strangler.md §5a.1 "Factory inversion").
 *
 * This is the ONE place provider construction inputs are read from the TTS
 * settings store. The old `lib/tts/providerFactory.ts` performed this read from
 * inside lib/tts (the S11 lib→store cycle edge); it is deleted — the manager now
 * receives this supplier injected from the composition roots
 * (`createWorkerEngineClient` / `getInProcessAudioPlayer`), so `src/lib/tts`
 * carries no provider-path store import.
 */
import { useTTSSettingsStore } from '@store/useTTSSettingsStore';
import type { ProviderBuildContext } from '@lib/tts/providers/registry';

/** Build-context inputs for a provider id, read live from the settings store. */
export function storeProviderBuildContext(providerId: string): Omit<ProviderBuildContext, 'sink'> {
    const { apiKeys, activeLanguage } = useTTSSettingsStore.getState();
    return {
        apiKey: (apiKeys as Record<string, string | undefined>)[providerId],
        language: activeLanguage || 'en',
    };
}
