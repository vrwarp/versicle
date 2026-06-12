/**
 * ProviderDescriptor registry — the single source of truth for TTS providers
 * (Phase 5a, plan/overhaul/prep/phase5-tts-strangler.md §5a.1).
 *
 * Everything previously hand-maintained across six sites (the union re-declared in
 * `useTTSStore`, the construction switch in `providerFactory`, the hardcoded items and
 * aliases in `TTSSettingsTab`, the magic `'local'` fallback key in `TTSProviderManager`,
 * the `as any` piper capability probing) derives from {@link PROVIDERS}:
 *
 *  - the provider-id unions ({@link RegisteredProviderId}, {@link TTSProviderId},
 *    {@link TTSApiKeyProviderId}),
 *  - construction ({@link ProviderDescriptor.build} with an injected
 *    {@link ProviderBuildContext} — no store reach-ins from this module),
 *  - the settings UI ({@link selectableProviders}), and
 *  - capability routing ({@link asVoiceDownloadable}, {@link asLocaleAware} — descriptor-
 *    driven type guards replacing `provider.id === 'piper' … as any`).
 *
 * Speed/pitch are deliberately NOT capabilities: the P0 speed policy (synthesize at 1.0,
 * playback rate applied at the audio sink, speed-free cache key) is the law of the tree —
 * no `synthesisSpeed` capability exists because no provider may opt out of it.
 *
 * The `'local'` id: both device providers still claim `id = 'local'` and the persisted
 * `providerId` keeps the `'local'` value — the webspeech/capacitor id split is DEFERRED to
 * the 5b settings-store migration (one-format-in-flight rule). Until then `'local'` is a
 * registry-level alias resolved per platform ({@link resolveDescriptor}).
 *
 * Main-thread only (provider classes wrap speechSynthesis / Capacitor / cloud fetch +
 * audio). The worker engine never imports this module — provider ids cross the boundary
 * as plain strings.
 */
import { Capacitor } from '@capacitor/core';
import type { ITTSProvider } from './types';
import type { AudioSink } from '../engine/AudioSink';
import { WebSpeechProvider } from './WebSpeechProvider';
import { CapacitorTTSProvider } from './CapacitorTTSProvider';
import { PiperProvider } from './PiperProvider';
import { GoogleTTSProvider } from './GoogleTTSProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { LemonFoxProvider } from './LemonFoxProvider';

/**
 * Everything a provider needs at construction time, injected by the caller
 * (the manager / app layer — never read from a store inside this module).
 */
export interface ProviderBuildContext {
    /** API key for cloud providers (descriptor.requiresApiKey). */
    apiKey?: string;
    /** Normalized active language (language-utils), e.g. 'en', 'zh'. */
    language: string;
    /**
     * The shared audio-output device for providers that play synthesized blobs.
     * ONE sink, owned and injected by `TTSProviderManager` (5a-PR2) so swapped-in
     * providers reuse the same `HTMLAudioElement` instead of leaking one each.
     * Optional only for direct construction in tests; the manager always passes it.
     */
    sink?: AudioSink;
}

export type ProviderKind = 'device' | 'wasm' | 'cloud';

export interface ProviderDescriptor {
    /** Stable provider id ('local' stays an alias for the device pair until 5b). */
    readonly id: string;
    readonly displayName: string;
    readonly kind: ProviderKind;
    readonly requiresApiKey: boolean;
    /** Label for the settings-UI API-key field (only when requiresApiKey). */
    readonly apiKeyLabel?: string;
    /** Platforms the settings UI offers this provider on (absent = all). */
    readonly platforms?: ReadonlyArray<'web' | 'native'>;
    readonly capabilities: {
        /** Gates the {@link asVoiceDownloadable} guard (voice download/delete UI). */
        downloadableVoices: boolean;
        /** Gates the {@link asLocaleAware} guard (text-segmentation locale). */
        localeAware: boolean;
    };
    build(ctx: ProviderBuildContext): ITTSProvider;
}

export const PROVIDERS = [
    {
        id: 'webspeech',
        displayName: 'Web Speech (Local)',
        kind: 'device',
        requiresApiKey: false,
        platforms: ['web'],
        capabilities: { downloadableVoices: false, localeAware: false },
        build: () => new WebSpeechProvider(),
    },
    {
        id: 'capacitor',
        displayName: 'System Speech (Local)',
        kind: 'device',
        requiresApiKey: false,
        platforms: ['native'],
        capabilities: { downloadableVoices: false, localeAware: false },
        build: () => new CapacitorTTSProvider(),
    },
    {
        id: 'piper',
        displayName: 'Piper (High Quality Local)',
        kind: 'wasm',
        requiresApiKey: false,
        capabilities: { downloadableVoices: true, localeAware: true },
        build: (ctx) => new PiperProvider(ctx.language || 'en', ctx.sink),
    },
    {
        id: 'google',
        displayName: 'Google Cloud TTS',
        kind: 'cloud',
        requiresApiKey: true,
        apiKeyLabel: 'Google API Key',
        capabilities: { downloadableVoices: false, localeAware: false },
        build: (ctx) => new GoogleTTSProvider(ctx.apiKey, ctx.sink),
    },
    {
        id: 'openai',
        displayName: 'OpenAI',
        kind: 'cloud',
        requiresApiKey: true,
        apiKeyLabel: 'OpenAI API Key',
        capabilities: { downloadableVoices: false, localeAware: false },
        build: (ctx) => new OpenAIProvider(ctx.apiKey, ctx.sink),
    },
    {
        id: 'lemonfox',
        displayName: 'LemonFox.ai',
        kind: 'cloud',
        requiresApiKey: true,
        apiKeyLabel: 'LemonFox API Key',
        capabilities: { downloadableVoices: false, localeAware: false },
        build: (ctx) => new LemonFoxProvider(ctx.apiKey, ctx.sink),
    },
] as const satisfies readonly ProviderDescriptor[];

/** Every registered descriptor id (the post-5b id space, incl. webspeech/capacitor). */
export type RegisteredProviderId = (typeof PROVIDERS)[number]['id'];

/**
 * The PERSISTED provider-id union (`useTTSStore.providerId`, settings UI values).
 * `'local'` is the platform-resolved alias for the device pair; the split to
 * 'webspeech'/'capacitor' lands with the 5b `tts-settings` migration.
 */
export type TTSProviderId = Exclude<RegisteredProviderId, 'webspeech' | 'capacitor'> | 'local';

/** Descriptor ids that require an API key (drives `apiKeys` map + settings fields). */
export type TTSApiKeyProviderId = Extract<(typeof PROVIDERS)[number], { requiresApiKey: true }>['id'];

type Platform = 'web' | 'native';

function currentPlatform(): Platform {
    return Capacitor.isNativePlatform() ? 'native' : 'web';
}

/** The device descriptor the `'local'` alias resolves to on the given platform. */
function deviceDescriptor(platform: Platform): ProviderDescriptor {
    const id: RegisteredProviderId = platform === 'native' ? 'capacitor' : 'webspeech';
    return PROVIDERS.find((d) => d.id === id)!;
}

/**
 * Resolve a provider id (persisted `'local'` alias included) to its descriptor.
 * Unknown ids fall back to the platform device provider — the pre-registry
 * `providerFactory` default branch, preserved verbatim.
 */
export function resolveDescriptor(providerId: string, platform: Platform = currentPlatform()): ProviderDescriptor {
    if (providerId === 'local') return deviceDescriptor(platform);
    return PROVIDERS.find((d) => d.id === providerId) ?? deviceDescriptor(platform);
}

/**
 * Descriptor lookup for a LIVE provider instance (capability guards). Both device
 * providers report `id === 'local'` until the 5b id split, so the alias resolves per
 * platform — harmless for guards because the device pair's capabilities are identical.
 */
function descriptorForInstance(provider: ITTSProvider): ProviderDescriptor | undefined {
    if (provider.id === 'local') return deviceDescriptor(currentPlatform());
    return PROVIDERS.find((d) => d.id === provider.id);
}

/** What the settings UI renders for one provider choice. */
export interface ProviderOption {
    /** The persisted id (the device entry surfaces under the `'local'` alias). */
    readonly id: TTSProviderId;
    readonly displayName: string;
    readonly kind: ProviderKind;
    readonly requiresApiKey: boolean;
    readonly apiKeyLabel?: string;
    readonly capabilities: ProviderDescriptor['capabilities'];
}

/**
 * The provider choices for the settings UI on the given platform, in stable UI order:
 * the platform's device provider (as `'local'`), then every non-device descriptor
 * available on that platform.
 */
export function selectableProviders(platform: Platform = currentPlatform()): ProviderOption[] {
    const device = deviceDescriptor(platform);
    const rest = PROVIDERS.filter(
        (d) => d.kind !== 'device' && (!('platforms' in d) || (d.platforms as readonly Platform[]).includes(platform)),
    );
    return [
        { ...optionFields(device), id: 'local' as const },
        ...rest.map((d) => ({ ...optionFields(d), id: d.id as TTSProviderId })),
    ];
}

function optionFields(d: ProviderDescriptor): Omit<ProviderOption, 'id'> {
    return {
        displayName: d.displayName,
        kind: d.kind,
        requiresApiKey: d.requiresApiKey,
        apiKeyLabel: d.apiKeyLabel,
        capabilities: d.capabilities,
    };
}

// ---------------------------------------------------------------------------
// Capability interfaces + descriptor-driven type guards (S12: no `as any`).
// ---------------------------------------------------------------------------

/** Providers whose voices are downloaded artifacts (Piper models). */
export interface VoiceDownloadable {
    downloadVoice(voiceId: string): Promise<void>;
    deleteVoice(voiceId: string): Promise<void>;
    isVoiceDownloaded(voiceId: string): Promise<boolean>;
}

/** Providers that segment text and therefore need the active locale. */
export interface LocaleAware {
    setLocale(locale: string): void;
}

/**
 * Narrow a live provider to its download capability, driven by the descriptor —
 * NOT by duck-typing the instance. Returns null for non-capable providers
 * (callers treat that as "voice is not a downloadable artifact").
 */
export function asVoiceDownloadable(provider: ITTSProvider): (ITTSProvider & VoiceDownloadable) | null {
    const descriptor = descriptorForInstance(provider);
    if (!descriptor?.capabilities.downloadableVoices) return null;
    return provider as ITTSProvider & VoiceDownloadable;
}

/** Narrow a live provider to its locale capability (descriptor-driven; see above). */
export function asLocaleAware(provider: ITTSProvider): (ITTSProvider & LocaleAware) | null {
    const descriptor = descriptorForInstance(provider);
    if (!descriptor?.capabilities.localeAware) return null;
    return provider as ITTSProvider & LocaleAware;
}
