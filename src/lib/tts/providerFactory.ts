/**
 * The single place a TTS provider is constructed from its id.
 *
 * Both engine paths (in-process and worker) route provider switching as a plain
 * `providerId` string into the main-thread backend, which builds the live provider here —
 * no live `ITTSProvider` ever crosses an engine API or the worker boundary. API keys and
 * the active language come from the TTS settings store at construction time.
 *
 * Main-thread only (providers wrap speechSynthesis / Capacitor / cloud fetch + audio).
 */
import { Capacitor } from '@capacitor/core';
import { useTTSStore } from '../../store/useTTSStore';
import { GoogleTTSProvider } from './providers/GoogleTTSProvider';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { LemonFoxProvider } from './providers/LemonFoxProvider';
import { PiperProvider } from './providers/PiperProvider';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { CapacitorTTSProvider } from './providers/CapacitorTTSProvider';
import type { ITTSProvider } from './providers/types';

export function buildProviderById(providerId: string): ITTSProvider {
    const { apiKeys, activeLanguage } = useTTSStore.getState();
    switch (providerId) {
        case 'google': return new GoogleTTSProvider(apiKeys.google);
        case 'openai': return new OpenAIProvider(apiKeys.openai);
        case 'lemonfox': return new LemonFoxProvider(apiKeys.lemonfox);
        case 'piper': return new PiperProvider(activeLanguage || 'en');
        default:
            return Capacitor.isNativePlatform() ? new CapacitorTTSProvider() : new WebSpeechProvider();
    }
}
