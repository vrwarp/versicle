/**
 * The single place a TTS provider is constructed from its id.
 *
 * Both engine paths (in-process and worker) route provider switching as a plain
 * `providerId` string into the main-thread backend, which builds the live provider here.
 * Construction itself is descriptor-driven (`providers/registry.ts` — the single source
 * of truth); this module's remaining job is assembling the {@link ProviderBuildContext}
 * from the TTS settings store.
 *
 * TRANSITIONAL (5a-PR1 → 5a-PR3): the `useTTSStore` read below is the last
 * lib/tts → store reach-in on the provider path. At 5a-PR3 the real call sites
 * (TTSProviderManager / the worker host backend) receive an injected context supplier
 * and this module's store import dies (depcruise: lib/tts → store edge hits 0).
 *
 * Main-thread only (providers wrap speechSynthesis / Capacitor / cloud fetch + audio).
 */
import { useTTSStore } from '@store/useTTSStore';
import { resolveDescriptor, type ProviderBuildContext } from './providers/registry';
import type { ITTSProvider } from './providers/types';

/** Assemble the build context for a provider id from the TTS settings store. */
function ctxFromStore(providerId: string, sink?: ProviderBuildContext['sink']): ProviderBuildContext {
    const { apiKeys, activeLanguage } = useTTSStore.getState();
    return {
        apiKey: (apiKeys as Record<string, string | undefined>)[providerId],
        language: activeLanguage || 'en',
        sink,
    };
}

export function buildProviderById(providerId: string, sink?: ProviderBuildContext['sink']): ITTSProvider {
    return resolveDescriptor(providerId).build(ctxFromStore(providerId, sink));
}
