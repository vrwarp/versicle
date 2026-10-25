import whiteNoiseUrl from '../../assets/10s_8k_sub_bass_vbr_off.webm';
import type { BackgroundAudioMode } from './BackgroundAudio';
import { createLogger } from '../logger';
import { localFetch } from '@kernel/net';

const logger = createLogger('WebAudioKeepalive');

/**
 * Peak amplitude of the always-on 40 Hz anchor tone: -60 dBFS RMS
 * (RMS = peak / sqrt(2)). Chromium freezes a hidden page that is not producing
 * sound, and on Android it counts a stream as sound only at or above about
 * -72 dBFS, so digital silence does not keep the page alive. 40 Hz at -60 dBFS
 * clears that threshold by about 11 dB while staying far below what phone
 * speakers and earpieces reproduce.
 */
export const ANCHOR_PEAK = 0.001 * Math.SQRT2;
export const ANCHOR_HZ = 40;

/** How often the watchdog checks the context while output is wanted. */
export const WATCHDOG_MS = 5_000;
/** How often the diagnostic heartbeat is logged while output is wanted. */
const HEARTBEAT_MS = 10_000;

type ContextFactory = () => AudioContext;

/**
 * Background-reading keepalive played through Web Audio instead of
 * HTMLAudioElements (same interface as BackgroundAudio).
 *
 * Why: Chromium never requests Android audio focus for Web Audio, so a phone
 * call does not pause it and the page stays awake through the call; the
 * element keepalive is paused by the call's focus request, after which the
 * hidden page freezes. The user's noise setting is kept: 'noise' plays the same
 * file at the same volume curve, layered over the anchor tone; 'silence' plays
 * the anchor tone alone.
 *
 * Experimental and opt-in (Diagnostics → Web Audio keepalive). While wanted it
 * logs a heartbeat (visibility, context state, currentTime) at warn level so a
 * screen-off test can be read from logcat.
 */
export class WebAudioKeepalive {
    private ctx: AudioContext | null = null;
    private master: GainNode | null = null;
    private noiseGain: GainNode | null = null;
    private noiseSource: AudioBufferSourceNode | null = null;
    private noiseBuffer: AudioBuffer | null = null;
    private noiseLoading: Promise<AudioBuffer | null> | null = null;

    private mode: BackgroundAudioMode = 'off';
    private wanted = false;
    private linearVolume = 0.1;

    private stopTimeout: ReturnType<typeof setTimeout> | null = null;
    private watchdog: ReturnType<typeof setInterval> | null = null;
    private heartbeat: ReturnType<typeof setInterval> | null = null;
    private lastTime = -1;
    private stalls = 0;

    constructor(private readonly createContext: ContextFactory = () => new AudioContext({ latencyHint: 'playback' })) {}

    private perceptual(v: number): number {
        return Math.pow(v, 3);
    }

    setVolume(volume: number) {
        this.linearVolume = Math.max(0, Math.min(1, volume));
        if (this.noiseGain) {
            this.noiseGain.gain.value = this.mode === 'noise' ? this.perceptual(this.linearVolume) : 0;
        }
    }

    play(mode: BackgroundAudioMode) {
        this.cancelDebounce();
        if (mode === 'off') {
            this.forceStop();
            return;
        }
        this.mode = mode;
        this.wanted = true;
        const ctx = this.ensureContext();
        if (!ctx) return;
        if (this.master) this.master.gain.value = 1;
        this.setVolume(this.linearVolume);
        if (mode === 'noise') {
            void this.ensureNoise();
        }
        if (ctx.state !== 'running') {
            ctx.resume().catch((e) => logger.warn('resume failed', e));
        }
        this.startTimers();
    }

    stopWithDebounce(delayMs: number) {
        this.cancelDebounce();
        this.stopTimeout = setTimeout(() => {
            this.stopTimeout = null;
            this.pauseOutput();
        }, delayMs);
    }

    cancelDebounce() {
        if (this.stopTimeout) {
            clearTimeout(this.stopTimeout);
            this.stopTimeout = null;
        }
    }

    forceStop() {
        this.cancelDebounce();
        this.pauseOutput();
        this.stopNoise();
        this.mode = 'off';
    }

    /** Releases the context entirely (used when switching back to the element keepalive). */
    dispose() {
        this.forceStop();
        const ctx = this.ctx;
        this.ctx = null;
        this.master = null;
        this.noiseGain = null;
        if (ctx && ctx.state !== 'closed') {
            ctx.close().catch(() => {});
        }
    }

    private pauseOutput() {
        this.wanted = false;
        this.stopTimers();
        if (this.ctx && this.ctx.state === 'running') {
            this.ctx.suspend().catch(() => {});
        }
    }

    private ensureContext(): AudioContext | null {
        if (this.ctx && this.ctx.state !== 'closed') return this.ctx;
        try {
            const ctx = this.createContext();
            const master = ctx.createGain();
            master.connect(ctx.destination);

            const tone = ctx.createOscillator();
            tone.type = 'sine';
            tone.frequency.value = ANCHOR_HZ;
            const toneGain = ctx.createGain();
            toneGain.gain.value = ANCHOR_PEAK;
            tone.connect(toneGain);
            toneGain.connect(master);
            tone.start();

            const noiseGain = ctx.createGain();
            noiseGain.gain.value = 0;
            noiseGain.connect(master);

            ctx.onstatechange = () => this.onStateChange();
            this.ctx = ctx;
            this.master = master;
            this.noiseGain = noiseGain;
            this.noiseSource = null;
            this.lastTime = -1;
            this.stalls = 0;
            return ctx;
        } catch (e) {
            logger.warn('AudioContext unavailable', e);
            return null;
        }
    }

    private async ensureNoise(): Promise<void> {
        const ctx = this.ctx;
        if (!ctx || !this.noiseGain || this.noiseSource) return;
        if (!this.noiseBuffer) {
            this.noiseLoading ??= localFetch(whiteNoiseUrl)
                .then((r) => r.arrayBuffer())
                .then((data) => ctx.decodeAudioData(data))
                .catch((e) => {
                    logger.warn('noise decode failed', e);
                    return null;
                })
                .finally(() => { this.noiseLoading = null; });
            this.noiseBuffer = await this.noiseLoading;
        }
        // The context, mode or wish may have changed while decoding.
        if (!this.noiseBuffer || this.ctx !== ctx || !this.noiseGain || this.noiseSource || this.mode !== 'noise' || !this.wanted) return;
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer;
        source.loop = true;
        source.connect(this.noiseGain);
        source.start();
        this.noiseSource = source;
    }

    private stopNoise() {
        if (this.noiseSource) {
            try { this.noiseSource.stop(); } catch { /* already stopped */ }
            this.noiseSource.disconnect();
            this.noiseSource = null;
        }
    }

    private onStateChange() {
        const ctx = this.ctx;
        if (!ctx) return;
        logger.warn('statechange', ctx.state);
        if (this.wanted && ctx.state !== 'running' && ctx.state !== 'closed') {
            ctx.resume().catch((e) => logger.warn('resume after statechange failed', e));
        }
    }

    /** Resumes a suspended context and rebuilds one whose clock stopped advancing. */
    checkHealth() {
        if (!this.wanted) return;
        const ctx = this.ctx;
        if (!ctx || ctx.state === 'closed') {
            this.rebuild('closed');
            return;
        }
        if (ctx.state !== 'running') {
            ctx.resume().catch(() => {});
            return;
        }
        if (ctx.currentTime <= this.lastTime) {
            this.stalls++;
            if (this.stalls >= 2) {
                this.rebuild('clock stalled');
                return;
            }
        } else {
            this.stalls = 0;
        }
        this.lastTime = ctx.currentTime;
    }

    private rebuild(reason: string) {
        logger.warn('rebuilding AudioContext', reason);
        const mode = this.mode;
        const old = this.ctx;
        this.stopNoise();
        this.ctx = null;
        this.master = null;
        this.noiseGain = null;
        if (old && old.state !== 'closed') old.close().catch(() => {});
        this.play(mode);
    }

    private startTimers() {
        if (!this.watchdog) {
            this.watchdog = setInterval(() => this.checkHealth(), WATCHDOG_MS);
        }
        if (!this.heartbeat) {
            this.heartbeat = setInterval(() => {
                const visibility = typeof document !== 'undefined' ? document.visibilityState : 'n/a';
                logger.warn('heartbeat', `visibility=${visibility}`, `ctx=${this.ctx?.state ?? 'none'}`,
                    `t=${this.ctx ? this.ctx.currentTime.toFixed(1) : '-'}`, `mode=${this.mode}`);
            }, HEARTBEAT_MS);
        }
    }

    private stopTimers() {
        if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
        if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
    }
}
