/**
 * describeProviderContract — the cross-provider behavioral contract
 * (Phase 5a-PR2, plan/overhaul/prep/phase5-tts-strangler.md §5a / Execution order).
 *
 * One suite, run against every provider through a per-provider harness (the same
 * write-once/run-everywhere pattern as `engineParityScenarios`). It pins the four
 * contract surfaces the strangler depends on:
 *
 *  1. play()/preload() semantics — play resolves when audible playback has started
 *     and emits exactly one 'start'; preload never starts playback or emits.
 *  2. SINGLE-SHOT failure signaling — one failure, one signal. Providers whose
 *     start handshake is observable reject (and never additionally emit an 'error'
 *     event); the Capacitor provider's optimistic-start path surfaces post-start
 *     failures as exactly one 'error' event instead (`failureMode: 'event'` — the
 *     native speak promise only settles on completion, so a rejection channel for
 *     start failures does not exist there).
 *  3. dispose() — listeners detach, nothing is emitted afterwards, and an INJECTED
 *     (shared, manager-owned) sink is never destroyed by the provider.
 *  4. Speed policy (P0 law) — synthesis always at 1.0: a non-1.0 playback speed
 *     never reaches a synthesis request; sink players apply it as the sink rate,
 *     device providers as the live speak rate. Sink players additionally prove the
 *     speed-free cache key: replaying the same text at a different speed performs
 *     ZERO new synthesis (cache key = hash(text|voiceId)).
 *
 * vi.mock is banned in providers/ (5a-PR2 lint flip): harnesses inject fakes
 * (FakeAudioSink, InMemoryTTSCache, stubbed fetch/speechSynthesis) instead.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ITTSProvider, TTSEvent } from './types';
import { TTSCache } from '../TTSCache';
import type { FakeAudioSink } from '../engine/FakeAudioSink';
import type { Timepoint } from '~types/tts';
import type { CacheAudioBlob } from '~types/cache';

/**
 * In-memory TTSCache for provider tests: real SHA-256 key generation (the golden
 * key contract lives in TTSCache.test.ts), Map-backed rows — no IndexedDB.
 */
export class InMemoryTTSCache extends TTSCache {
    readonly rows = new Map<string, CacheAudioBlob>();

    override async get(key: string): Promise<CacheAudioBlob | undefined> {
        return this.rows.get(key);
    }

    override async put(key: string, audio: ArrayBuffer, alignment?: Timepoint[]): Promise<void> {
        this.rows.set(key, {
            key,
            audio,
            alignment,
            createdAt: Date.now(),
            lastAccessed: Date.now(),
        } as CacheAudioBlob);
    }
}

export interface ProviderContractHarness {
    provider: ITTSProvider;
    /** A voice id `play()` accepts on this provider. */
    voiceId: string;
    /**
     * How a failure to start playback surfaces (see module doc §2):
     * 'reject' — play() rejects once, zero 'error' events;
     * 'event'  — play() resolves optimistically, exactly one 'error' event follows.
     */
    failureMode: 'reject' | 'event';
    /** Arm the NEXT play()/synthesis to fail. */
    armPlayFailure(): void;
    /** Raw synthesis request bodies issued so far (cloud fetches). Empty for device providers. */
    synthesisBodies(): string[];
    /** Live speak rates issued to a device speech engine (no synthesized artifact). */
    liveSpeakRates(): number[];
    /** The injected shared sink, for providers that play synthesized blobs. */
    sink?: FakeAudioSink;
    /** Optional per-harness teardown (unstub globals). */
    teardown?(): void;
}

export function describeProviderContract(
    name: string,
    makeHarness: () => Promise<ProviderContractHarness> | ProviderContractHarness,
): void {
    describe(`provider contract [${name}]`, () => {
        async function withHarness(run: (h: ProviderContractHarness) => Promise<void>) {
            const h = await makeHarness();
            try {
                await run(h);
            } finally {
                h.provider.dispose();
                h.teardown?.();
            }
        }

        function recordEvents(h: ProviderContractHarness): TTSEvent[] {
            const events: TTSEvent[] = [];
            h.provider.on((e) => events.push(e));
            return events;
        }

        it("play() resolves once playback has started and emits exactly one 'start'", () =>
            withHarness(async (h) => {
                const events = recordEvents(h);

                await h.provider.play('The quick brown fox.', { voiceId: h.voiceId, speed: 1.0 });

                await vi.waitFor(() =>
                    expect(events.filter((e) => e.type === 'start').length).toBe(1));
                if (h.sink) {
                    expect(h.sink.playedBlobs.length).toBe(1);
                }
            }));

        it('preload() never starts playback and never emits lifecycle events', () =>
            withHarness(async (h) => {
                const events = recordEvents(h);

                await h.provider.preload('Preloaded but unspoken.', { voiceId: h.voiceId, speed: 1.0 });
                // Let any stray async event delivery land before asserting silence.
                await new Promise((r) => setTimeout(r, 10));

                expect(events.filter((e) => e.type === 'start' || e.type === 'end')).toEqual([]);
                if (h.sink) {
                    expect(h.sink.playedBlobs.length).toBe(0);
                }
            }));

        it('a failure surfaces through exactly ONE channel (single-shot signaling)', () =>
            withHarness(async (h) => {
                const events = recordEvents(h);
                h.armPlayFailure();

                if (h.failureMode === 'reject') {
                    await expect(
                        h.provider.play('This will fail.', { voiceId: h.voiceId, speed: 1.0 }),
                    ).rejects.toBeTruthy();
                    // The rejection is the ONLY signal: no 'error' event for the same failure.
                    await new Promise((r) => setTimeout(r, 10));
                    expect(events.filter((e) => e.type === 'error')).toEqual([]);
                } else {
                    // Optimistic-start providers (Capacitor): play() resolves; the failure
                    // arrives as exactly one 'error' event.
                    await h.provider.play('This will fail.', { voiceId: h.voiceId, speed: 1.0 });
                    await vi.waitFor(() =>
                        expect(events.filter((e) => e.type === 'error').length).toBe(1));
                    await new Promise((r) => setTimeout(r, 10));
                    expect(events.filter((e) => e.type === 'error').length).toBe(1);
                }
            }));

        it('on() returns a working unsubscribe', () =>
            withHarness(async (h) => {
                const events: TTSEvent[] = [];
                const unsubscribe = h.provider.on((e) => events.push(e));
                unsubscribe();

                await h.provider.play('Nobody is listening.', { voiceId: h.voiceId, speed: 1.0 });
                await new Promise((r) => setTimeout(r, 10));

                expect(events).toEqual([]);
            }));

        it('dispose() detaches listeners and emits nothing afterwards', () =>
            withHarness(async (h) => {
                const events = recordEvents(h);

                h.provider.dispose();
                await h.provider.play('Spoken into the void.', { voiceId: h.voiceId, speed: 1.0 })
                    .catch(() => { /* a disposed provider may reject — it must just not EMIT */ });
                await new Promise((r) => setTimeout(r, 10));

                expect(events).toEqual([]);
                if (h.sink) {
                    // The shared sink is manager-owned: dispose must never destroy it.
                    expect(h.sink.destroyed).toBe(false);
                }
            }));

        it('speed policy: a non-1.0 speed is playback-time only — synthesis stays at 1.0', () =>
            withHarness(async (h) => {
                await h.provider.play('Speed policy pin.', { voiceId: h.voiceId, speed: 1.7 });

                if (h.sink) {
                    // Synthesized-artifact path: the request body carries no rate…
                    for (const body of h.synthesisBodies()) {
                        expect(body).not.toContain('1.7');
                        expect(body.toLowerCase()).not.toMatch(/speakingrate|"speed"|"rate"/);
                    }
                    // …and the sink applies the rate at playback time.
                    expect(h.sink.rate).toBe(1.7);
                } else {
                    // Device path: no artifact, no cache — live speech legitimately
                    // speaks at the requested rate.
                    expect(h.liveSpeakRates()).toContain(1.7);
                }
            }));

        it('cache key is speed-free: same text at a new speed performs zero new synthesis', () =>
            withHarness(async (h) => {
                if (!h.sink) return; // device providers have no synthesized artifact/cache

                await h.provider.play('Cached once, played twice.', { voiceId: h.voiceId, speed: 1.0 });
                const synthesisCount = h.synthesisBodies().length;
                expect(synthesisCount).toBeGreaterThan(0);

                await h.provider.play('Cached once, played twice.', { voiceId: h.voiceId, speed: 1.7 });

                expect(h.synthesisBodies().length).toBe(synthesisCount);
                expect(h.sink.playedBlobs.length).toBe(2);
                expect(h.sink.rate).toBe(1.7);
            }));
    });
}
