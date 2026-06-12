/**
 * TTSProviderManager suite (Phase 5a-PR2) — the manager as a dumb holder:
 * event normalization, swap hygiene (detach + dispose + shared sink), and the
 * single failure path (typed rethrow, no self-swap, no synthetic 'fallback').
 *
 * Absorbs the pre-5a `TTSProviderManager.test.ts` per the absorption ledger
 * (plan/overhaul/prep/phase5-absorption-ledger.md row 16): the surviving
 * assertions live in the named regression block below; the legacy
 * fallback-double-fire case is superseded by the single-path tests here plus
 * the engine-level P21 parity scenario (both transports). No module mocks —
 * providers are injected `FakeTTSProvider` doubles via the setProvider seam
 * (jsdom is the web platform, so the construction-time default provider is the
 * inert WebSpeechProvider).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TTSProviderManager, type TTSProviderEvents } from './TTSProviderManager';
import { FakeAudioSink } from './engine/FakeAudioSink';
import { FakeTTSProvider } from '@test/harness/fakeTTSProvider';

function makeEvents(): TTSProviderEvents {
    return {
        onStart: vi.fn(),
        onEnd: vi.fn(),
        onError: vi.fn(),
        onTimeUpdate: vi.fn(),
        onDownloadProgress: vi.fn(),
    };
}

describe('TTSProviderManager', () => {
    let events: TTSProviderEvents;
    let manager: TTSProviderManager;
    let provider: FakeTTSProvider;

    beforeEach(() => {
        events = makeEvents();
        manager = new TTSProviderManager(events, new FakeAudioSink());
        provider = new FakeTTSProvider({ id: 'fake' });
        manager.setProvider(provider);
    });

    describe('regression: TTSProviderManager.test (pre-5a)', () => {
        it('initializes and listens on the active provider', () => {
            expect(manager.providerId).toBe('fake');
            // The manager registered exactly one listener on the injected provider.
            expect(provider['listeners'].size).toBe(1);
        });

        it('proxies play calls to the provider', async () => {
            await manager.play('text', { voiceId: 'v1', speed: 1 });
            expect(provider.play).toHaveBeenCalledWith('text', { voiceId: 'v1', speed: 1 });
        });

        it('forwards start/end events', () => {
            provider.emit({ type: 'start' });
            expect(events.onStart).toHaveBeenCalled();

            provider.emit({ type: 'end' });
            expect(events.onEnd).toHaveBeenCalled();
        });
    });

    describe('event normalization', () => {
        it('filters interruption errors (cancel/stop are not errors)', () => {
            provider.emit({ type: 'error', error: { error: 'interrupted', message: 'interrupted' } });
            provider.emit({ type: 'error', error: { error: 'canceled', message: 'canceled' } });
            expect(events.onError).not.toHaveBeenCalled();
        });

        it('forwards real mid-playback errors verbatim — never as a synthetic fallback', () => {
            vi.spyOn(console, 'error').mockImplementation(() => {});
            const payload = { message: 'decoder exploded' };
            provider.emit({ type: 'error', error: payload });

            expect(events.onError).toHaveBeenCalledTimes(1);
            expect(events.onError).toHaveBeenCalledWith(payload);
            // The pre-5a manager re-shaped this into {type:'fallback'} and self-swapped;
            // both behaviors are dead (the engine owns recovery).
            expect(events.onError).not.toHaveBeenCalledWith(
                expect.objectContaining({ type: 'fallback' }));
            expect(manager.providerId).toBe('fake');
        });
    });

    describe('single failure path (S2 double-fire dead)', () => {
        it('rethrows play failures as ProviderPlaybackError without self-swapping or emitting', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => {});
            provider.play = vi.fn(async () => { throw new Error('quota exceeded'); });

            await expect(manager.play('text', { voiceId: 'v1', speed: 1 }))
                .rejects.toMatchObject({
                    name: 'ProviderPlaybackError',
                    providerId: 'fake',
                });

            // Exactly one signal: the rejection. No event, no swap.
            expect(events.onError).not.toHaveBeenCalled();
            expect(manager.providerId).toBe('fake');
        });

        it('rethrows interruptions raw (AbortError / interrupted are never fallback-worthy)', async () => {
            const abort = new DOMException('stopped', 'AbortError');
            provider.play = vi.fn(async () => { throw abort; });

            await expect(manager.play('text', { voiceId: 'v1', speed: 1 })).rejects.toBe(abort);
            expect(events.onError).not.toHaveBeenCalled();
        });
    });

    describe('swap hygiene (S12: stale providers neither emit nor leak)', () => {
        it('detaches from and disposes the outgoing provider on swap', () => {
            const next = new FakeTTSProvider({ id: 'next' });
            manager.setProvider(next);

            expect(provider.stop).toHaveBeenCalled();
            expect(provider.dispose).toHaveBeenCalled();

            // Events from the OLD provider no longer reach the engine…
            vi.mocked(events.onStart).mockClear();
            provider.emit({ type: 'start' });
            expect(events.onStart).not.toHaveBeenCalled();

            // …while the new provider's do.
            next.emit({ type: 'start' });
            expect(events.onStart).toHaveBeenCalledTimes(1);
        });
    });

    describe('descriptor-driven capability routing', () => {
        it('routes voice download calls only to downloadable providers (piper)', async () => {
            const piper = new FakeTTSProvider({ id: 'piper' });
            manager.setProvider(piper);

            await manager.downloadVoice('piper:en_US-x');
            await manager.deleteVoice('piper:en_US-x');
            expect(piper.downloadVoice).toHaveBeenCalledWith('piper:en_US-x');
            expect(piper.deleteVoice).toHaveBeenCalledWith('piper:en_US-x');
            await expect(manager.isVoiceDownloaded('piper:en_US-x')).resolves.toBe(true);
        });

        it('answers isVoiceDownloaded=false for non-downloadable providers (the pre-5a true was a UI lie)', async () => {
            // 'fake' has no descriptor → not downloadable.
            await manager.downloadVoice('v1');
            expect(provider.downloadVoice).not.toHaveBeenCalled();
            await expect(manager.isVoiceDownloaded('v1')).resolves.toBe(false);
        });

        it('routes setLocale only to locale-aware providers', () => {
            manager.setLocale('zh');
            expect(provider.setLocale).not.toHaveBeenCalled();

            const piper = new FakeTTSProvider({ id: 'piper' });
            manager.setProvider(piper);
            manager.setLocale('zh');
            expect(piper.setLocale).toHaveBeenCalledWith('zh');
        });
    });
});
