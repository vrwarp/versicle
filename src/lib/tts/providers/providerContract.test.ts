/**
 * The shared provider contract (describeProviderContract.ts), run against every
 * provider through a per-provider harness — 5a-PR2. PiperProvider joins at 5a-PR3
 * when `PiperRuntime` becomes injectable (its synthesis path is still the
 * module-global piper-utils worker until then).
 *
 * vi.mock appears exactly once: for the Capacitor NATIVE plugin module — the one
 * boundary with no injection seam (allowlisted in eslint.config.js, mirroring the
 * engine-dir PlatformIntegration entry). Everything else is injected fakes:
 * FakeAudioSink + InMemoryTTSCache + stubbed fetch/speechSynthesis.
 */
import { describe, vi, afterEach } from 'vitest';
import { describeProviderContract, InMemoryTTSCache, type ProviderContractHarness } from './describeProviderContract';
import { FakeAudioSink } from '../engine/FakeAudioSink';
import { GoogleTTSProvider } from './GoogleTTSProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { LemonFoxProvider } from './LemonFoxProvider';
import { WebSpeechProvider } from './WebSpeechProvider';
import { CapacitorTTSProvider } from './CapacitorTTSProvider';

// ---------------------------------------------------------------------------
// Capacitor native plugin double (no injection seam exists for a registered
// Capacitor plugin — the single allowlisted vi.mock in providers/).
// ---------------------------------------------------------------------------
const capacitorSpeak = vi.hoisted(() => ({
    /** rates recorded per speak() call */
    rates: [] as number[],
    failNext: false,
}));

vi.mock('@capacitor-community/text-to-speech', () => ({
    TextToSpeech: {
        speak: vi.fn(async (opts: { rate: number }) => {
            capacitorSpeak.rates.push(opts.rate);
            if (capacitorSpeak.failNext) {
                capacitorSpeak.failNext = false;
                throw new Error('native speak failed');
            }
        }),
        stop: vi.fn(async () => {}),
        getSupportedVoices: vi.fn(async () => ({
            voices: [{ voiceURI: 'cap-voice-1', name: 'Cap Voice', lang: 'en-US' }],
        })),
        addListener: vi.fn(async () => ({ remove: vi.fn(async () => {}) })),
    },
}));

describe('TTS provider contract (5a-PR2)', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // -----------------------------------------------------------------------
    // Cloud providers: FakeAudioSink + InMemoryTTSCache + stubbed fetch.
    // -----------------------------------------------------------------------

    interface FetchScript {
        bodies: string[];
        failNext: boolean;
        respond(): Promise<Response>;
    }

    function stubFetch(respond: (script: FetchScript) => Promise<Response>): FetchScript {
        const script: FetchScript = {
            bodies: [],
            failNext: false,
            respond: () => respond(script),
        };
        vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
            if (init?.body) script.bodies.push(String(init.body));
            if (script.failNext) {
                script.failNext = false;
                return { ok: false, status: 500, statusText: 'Quota exceeded', text: async () => 'quota' } as unknown as Response;
            }
            return script.respond();
        }));
        return script;
    }

    function cloudHarness(
        build: (sink: FakeAudioSink, cache: InMemoryTTSCache) => ProviderContractHarness['provider'],
        voiceId: string,
        respond: (script: FetchScript) => Promise<Response>,
    ): () => ProviderContractHarness {
        return () => {
            const sink = new FakeAudioSink();
            const cache = new InMemoryTTSCache();
            const script = stubFetch(respond);
            return {
                provider: build(sink, cache),
                voiceId,
                failureMode: 'reject',
                armPlayFailure: () => { script.failNext = true; },
                synthesisBodies: () => script.bodies,
                liveSpeakRates: () => [],
                sink,
            };
        };
    }

    describeProviderContract('google', cloudHarness(
        (sink, cache) => new GoogleTTSProvider('contract-test-key', sink, cache),
        'en-US-Standard-A',
        async () => ({
            ok: true,
            json: async () => ({ audioContent: btoa('synthesized-audio') }),
        } as unknown as Response),
    ));

    describeProviderContract('openai', cloudHarness(
        (sink, cache) => new OpenAIProvider('contract-test-key', sink, cache),
        'alloy',
        async () => ({
            ok: true,
            blob: async () => new Blob(['synthesized-audio'], { type: 'audio/mp3' }),
        } as unknown as Response),
    ));

    describeProviderContract('lemonfox', cloudHarness(
        (sink, cache) => new LemonFoxProvider('contract-test-key', sink, cache),
        'heart',
        async () => ({
            ok: true,
            blob: async () => new Blob(['synthesized-audio'], { type: 'audio/mp3' }),
        } as unknown as Response),
    ));

    // -----------------------------------------------------------------------
    // Web Speech: stubbed speechSynthesis + utterance lifecycle.
    // -----------------------------------------------------------------------

    describeProviderContract('webspeech', () => {
        const rates: number[] = [];
        let failNext = false;

        const synth = {
            getVoices: vi.fn(() => [{ name: 'Contract Voice', lang: 'en-US' }]),
            speak: vi.fn((utterance: SpeechSynthesisUtterance) => {
                rates.push(utterance.rate);
                queueMicrotask(() => {
                    if (failNext) {
                        failNext = false;
                        utterance.onerror?.({ error: 'synthesis-failed', type: 'error' } as SpeechSynthesisErrorEvent);
                    } else {
                        utterance.onstart?.({} as SpeechSynthesisEvent);
                    }
                });
            }),
            cancel: vi.fn(),
            pause: vi.fn(),
            resume: vi.fn(),
            speaking: false,
            paused: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        };
        // Direct assignment (not vi.stubGlobal): jsdom's window.speechSynthesis
        // slot rejects redefinition via defineProperty but accepts assignment —
        // the same pattern as WebSpeechProvider.test.ts.
        const g = globalThis as { speechSynthesis?: unknown; SpeechSynthesisUtterance?: unknown };
        const prevSynth = g.speechSynthesis;
        const prevUtterance = g.SpeechSynthesisUtterance;
        g.speechSynthesis = synth;
        // jsdom has no SpeechSynthesisUtterance; a plain carrier object suffices.
        g.SpeechSynthesisUtterance = function (this: { text: string }, text: string) {
            this.text = text;
        };

        const provider = new WebSpeechProvider();
        return {
            provider,
            voiceId: 'Contract Voice',
            failureMode: 'reject' as const,
            armPlayFailure: () => { failNext = true; },
            synthesisBodies: () => [],
            liveSpeakRates: () => rates,
            teardown: () => {
                g.speechSynthesis = prevSynth;
                g.SpeechSynthesisUtterance = prevUtterance;
            },
        };
    });

    // -----------------------------------------------------------------------
    // Capacitor: native plugin double (optimistic start — see module doc).
    // -----------------------------------------------------------------------

    describeProviderContract('capacitor', async () => {
        capacitorSpeak.rates.length = 0;
        capacitorSpeak.failNext = false;
        const provider = new CapacitorTTSProvider();
        await provider.init();
        return {
            provider,
            voiceId: 'cap-voice-1',
            // The native speak promise settles on COMPLETION, so a start failure has
            // no rejection channel: it surfaces as exactly one 'error' event after
            // the optimistic 'start'.
            failureMode: 'event' as const,
            armPlayFailure: () => { capacitorSpeak.failNext = true; },
            synthesisBodies: () => [],
            liveSpeakRates: () => capacitorSpeak.rates,
        };
    });
});
