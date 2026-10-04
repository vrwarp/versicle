import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebAudioKeepalive, ANCHOR_HZ, ANCHOR_PEAK, WATCHDOG_MS } from './WebAudioKeepalive';
import { KeepaliveSelector } from './KeepaliveSelector';
import { isWebAudioKeepaliveEnabled, setWebAudioKeepaliveEnabled } from './keepaliveFlags';
import type { BackgroundAudio } from './BackgroundAudio';

/** Minimal Web Audio graph fake: records nodes, gains and context state. */
class FakeParam { value = 0; }
class FakeNode {
    connections: unknown[] = [];
    connect(n: unknown) { this.connections.push(n); return n; }
    disconnect() { this.connections = []; }
}
class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeOscillator extends FakeNode {
    type = 'sine'; frequency = new FakeParam(); started = false;
    start() { this.started = true; }
}
class FakeBufferSource extends FakeNode {
    buffer: unknown = null; loop = false; started = false; stopped = false;
    start() { this.started = true; }
    stop() { this.stopped = true; }
}
class FakeContext {
    state: AudioContextState = 'suspended';
    currentTime = 0;
    destination = new FakeNode();
    onstatechange: (() => void) | null = null;
    gains: FakeGain[] = [];
    oscillators: FakeOscillator[] = [];
    sources: FakeBufferSource[] = [];
    resumes = 0; suspends = 0; closed = false;
    createGain() { const g = new FakeGain(); this.gains.push(g); return g; }
    createOscillator() { const o = new FakeOscillator(); this.oscillators.push(o); return o; }
    createBufferSource() { const s = new FakeBufferSource(); this.sources.push(s); return s; }
    decodeAudioData() { return Promise.resolve({ duration: 10 }); }
    resume() { this.resumes++; this.setState('running'); return Promise.resolve(); }
    suspend() { this.suspends++; this.setState('suspended'); return Promise.resolve(); }
    close() { this.closed = true; this.setState('closed'); return Promise.resolve(); }
    setState(s: AudioContextState) { this.state = s; this.onstatechange?.(); }
}

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

describe('WebAudioKeepalive', () => {
    let contexts: FakeContext[];
    let keepalive: WebAudioKeepalive;

    beforeEach(() => {
        vi.useFakeTimers();
        contexts = [];
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })));
        keepalive = new WebAudioKeepalive(() => {
            const c = new FakeContext();
            contexts.push(c);
            return c as unknown as AudioContext;
        });
    });

    afterEach(() => {
        keepalive.dispose();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("'silence' plays only the 40 Hz anchor at -60 dBFS RMS and resumes the context", () => {
        keepalive.play('silence');
        const ctx = contexts[0];
        expect(ctx.state).toBe('running');
        expect(ctx.oscillators).toHaveLength(1);
        expect(ctx.oscillators[0].frequency.value).toBe(ANCHOR_HZ);
        expect(ctx.oscillators[0].started).toBe(true);
        expect(ANCHOR_PEAK / Math.SQRT2).toBeCloseTo(0.001, 6); // -60 dBFS RMS
        expect(ctx.gains.some((g) => g.gain.value === ANCHOR_PEAK)).toBe(true);
        expect(ctx.sources).toHaveLength(0);
    });

    it("'noise' layers the user's noise at the existing volume curve over the anchor", async () => {
        keepalive.setVolume(0.5);
        keepalive.play('noise');
        await flush();
        const ctx = contexts[0];
        expect(ctx.sources).toHaveLength(1);
        expect(ctx.sources[0].loop).toBe(true);
        expect(ctx.sources[0].started).toBe(true);
        expect(ctx.gains.some((g) => g.gain.value === Math.pow(0.5, 3))).toBe(true);
        expect(ctx.oscillators[0].started).toBe(true); // anchor still on
    });

    it('stopWithDebounce suspends after the delay; play before it cancels the stop', () => {
        keepalive.play('silence');
        const ctx = contexts[0];
        keepalive.stopWithDebounce(500);
        vi.advanceTimersByTime(400);
        keepalive.play('silence');
        vi.advanceTimersByTime(200);
        expect(ctx.state).toBe('running');

        keepalive.stopWithDebounce(500);
        vi.advanceTimersByTime(500);
        expect(ctx.state).toBe('suspended');
    });

    it('re-resumes when the context is suspended behind its back while wanted', () => {
        keepalive.play('silence');
        const ctx = contexts[0];
        const before = ctx.resumes;
        ctx.setState('suspended');
        expect(ctx.resumes).toBe(before + 1);
        expect(ctx.state).toBe('running');
    });

    it('rebuilds the context when its clock stops advancing', () => {
        keepalive.play('silence');
        const ctx = contexts[0];
        ctx.currentTime = 1;
        vi.advanceTimersByTime(WATCHDOG_MS); // records t=1
        vi.advanceTimersByTime(WATCHDOG_MS); // stall 1
        vi.advanceTimersByTime(WATCHDOG_MS); // stall 2 -> rebuild
        expect(ctx.closed).toBe(true);
        expect(contexts).toHaveLength(2);
        expect(contexts[1].state).toBe('running');
    });

    it('does not rebuild while the clock advances', () => {
        keepalive.play('silence');
        const ctx = contexts[0];
        for (let i = 1; i <= 5; i++) {
            ctx.currentTime = i * 5;
            vi.advanceTimersByTime(WATCHDOG_MS);
        }
        expect(contexts).toHaveLength(1);
    });

    it('forceStop and off stop output and the noise source', async () => {
        keepalive.play('noise');
        await flush();
        const ctx = contexts[0];
        keepalive.play('off');
        expect(ctx.state).toBe('suspended');
        expect(ctx.sources[0].stopped).toBe(true);
    });

    it('logs a heartbeat while wanted and stops logging once stopped', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        keepalive.play('silence');
        vi.advanceTimersByTime(10_000);
        const beats = warn.mock.calls.filter((c) => String(c[1]) === 'heartbeat').length;
        expect(beats).toBe(1);
        keepalive.forceStop();
        vi.advanceTimersByTime(30_000);
        expect(warn.mock.calls.filter((c) => String(c[1]) === 'heartbeat').length).toBe(1);
        warn.mockRestore();
    });
});

describe('KeepaliveSelector', () => {
    function fakeElement() {
        return {
            play: vi.fn(), stopWithDebounce: vi.fn(), cancelDebounce: vi.fn(), forceStop: vi.fn(), setVolume: vi.fn(),
        } as unknown as BackgroundAudio & Record<string, ReturnType<typeof vi.fn>>;
    }
    function fakeWebAudio() {
        return {
            play: vi.fn(), stopWithDebounce: vi.fn(), cancelDebounce: vi.fn(), forceStop: vi.fn(), setVolume: vi.fn(), dispose: vi.fn(),
        };
    }

    it('uses the element keepalive unchanged by default', () => {
        const el = fakeElement();
        const sel = new KeepaliveSelector(el, () => false);
        sel.play('noise');
        sel.stopWithDebounce(500);
        expect(el.play).toHaveBeenCalledWith('noise');
        expect(el.stopWithDebounce).toHaveBeenCalledWith(500);
        expect(sel.kind).toBe('element');
    });

    it('switches to Web Audio when enabled, stopping the element first, and back when disabled', () => {
        const el = fakeElement();
        const wa = fakeWebAudio();
        let on = true;
        // The selector only needs the backend's methods; the class check is satisfied by the prototype.
        const sel = new KeepaliveSelector(el, () => on, () => Object.setPrototypeOf(wa, WebAudioKeepalive.prototype));
        sel.setVolume(0.3);
        sel.play('silence');
        expect(el.forceStop).toHaveBeenCalled();
        expect(wa.setVolume).toHaveBeenCalledWith(0.3);
        expect(wa.play).toHaveBeenCalledWith('silence');
        expect(sel.kind).toBe('webaudio');

        on = false;
        sel.play('silence');
        expect(wa.dispose).toHaveBeenCalled();
        expect(el.play).toHaveBeenCalledWith('silence');
        expect(sel.kind).toBe('element');
    });
});

describe('keepaliveFlags', () => {
    afterEach(() => setWebAudioKeepaliveEnabled(false));

    it('persists the device-local switch', () => {
        expect(isWebAudioKeepaliveEnabled()).toBe(false);
        setWebAudioKeepaliveEnabled(true);
        expect(isWebAudioKeepaliveEnabled()).toBe(true);
        setWebAudioKeepaliveEnabled(false);
        expect(isWebAudioKeepaliveEnabled()).toBe(false);
    });
});
