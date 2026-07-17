/**
 * Unit tests for WorkerEngineHandle — the app-facing adapter over the async worker client.
 * Covers the boot-buffering contract, whenReady, snapshot replay/fan-out (5b-PR2: the single
 * PlaybackSnapshot channel — seq ordering, queue re-attachment, TTS_COMMAND_FAILED), command
 * routing, and the jsdom/SSR `disabled` no-op mode.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PlaybackSnapshot, SnapshotListener } from '@lib/tts/engine/TtsEngine';

const { clientState } = vi.hoisted(() => ({
    clientState: {
        // Deferred so tests control when the "worker" finishes booting.
        // The promise + resolve/reject are (re)created in beforeEach so they
        // exist BEFORE the factory runs: WorkerEngineHandle now DYNAMICALLY
        // imports createWorkerEngineClient (perf — keeps the TTS backend graph
        // out of the entry chunk), so the factory is invoked a microtask after
        // construction. Capturing resolve inside the factory would leave
        // `clientState.resolve` undefined at the point tests drive boot.
        promise: undefined as undefined | Promise<unknown>,
        resolve: undefined as undefined | ((c: unknown) => void),
        reject: undefined as undefined | ((e: unknown) => void),
        client: undefined as undefined | Record<string, unknown>,
        subscribeListener: undefined as undefined | SnapshotListener,
    },
}));

vi.mock('./createWorkerEngineClient', () => ({
    createWorkerEngineClient: vi.fn(() => clientState.promise),
}));

import { WorkerEngineHandle } from './WorkerEngineHandle';

/** A worker-side snapshot as broadcast over the channel (queue optional). */
function snap(partial: Partial<PlaybackSnapshot> & { seq: number }): PlaybackSnapshot {
    return {
        status: 'stopped',
        queueId: 'q1',
        index: 0,
        sectionIndex: -1,
        activeCfi: null,
        error: null,
        download: null,
        ...partial,
    };
}

function makeFakeClient() {
    const engine = {
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        setVoice: vi.fn().mockResolvedValue(undefined),
        setSpeed: vi.fn().mockResolvedValue(undefined),
        setProviderById: vi.fn().mockResolvedValue(undefined),
        getVoices: vi.fn().mockResolvedValue([{ id: 'v1', name: 'V', lang: 'en', provider: 'local' }]),
        loadSection: vi.fn().mockResolvedValue(undefined),
        seek: vi.fn().mockResolvedValue(undefined),
        seekTo: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
        engine,
        subscribe: vi.fn(async (listener: SnapshotListener) => {
            clientState.subscribeListener = listener;
            return () => {};
        }),
        setBook: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn(),
    };
    clientState.client = client;
    return client;
}

describe('WorkerEngineHandle (Worker available)', () => {
    beforeEach(() => {
        // Fresh deferred per test — created HERE (not inside the mock factory)
        // so clientState.resolve is defined before the handle's dynamic import
        // invokes the factory. See the vi.hoisted comment above.
        clientState.promise = new Promise((resolve, reject) => {
            clientState.resolve = resolve as (c: unknown) => void;
            clientState.reject = reject;
        });
        clientState.subscribeListener = undefined;
        // jsdom has no Worker; define one so the handle takes the live path.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).Worker = class {};
    });

    afterEach(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (globalThis as any).Worker;
        vi.clearAllMocks();
    });

    it('buffers commands issued before boot and flushes them in order once ready', async () => {
        const handle = new WorkerEngineHandle();
        const client = makeFakeClient();

        // Issued while the worker is still booting.
        void handle.play();
        void handle.setVoice('voice-1');
        void handle.pause();

        expect(client.engine.play).not.toHaveBeenCalled();

        clientState.resolve!(client);
        await handle.whenReady();
        await vi.waitFor(() => expect(client.engine.pause).toHaveBeenCalled());

        expect(client.engine.play).toHaveBeenCalled();
        expect(client.engine.setVoice).toHaveBeenCalledWith('voice-1');
        // Flushed in issue order.
        expect(client.engine.play.mock.invocationCallOrder[0])
            .toBeLessThan(client.engine.setVoice.mock.invocationCallOrder[0]);
        expect(client.engine.setVoice.mock.invocationCallOrder[0])
            .toBeLessThan(client.engine.pause.mock.invocationCallOrder[0]);
    });

    it('whenReady resolves only after the client is booted AND subscribed', async () => {
        const handle = new WorkerEngineHandle();
        const client = makeFakeClient();

        let ready = false;
        const readyPromise = handle.whenReady().then(() => { ready = true; });

        await Promise.resolve();
        expect(ready).toBe(false);

        clientState.resolve!(client);
        await readyPromise;
        expect(ready).toBe(true);
        expect(client.subscribe).toHaveBeenCalled();
    });

    it('fans snapshots out to subscribers and replays the latest snapshot on subscribe', async () => {
        const handle = new WorkerEngineHandle();
        const client = makeFakeClient();
        clientState.resolve!(client);
        await handle.whenReady();

        const seen: string[] = [];
        handle.subscribe((s) => { seen.push(s.status); });

        // The internal subscription delivers a live update → fan-out.
        clientState.subscribeListener!(snap({ seq: 1, status: 'playing', activeCfi: 'cfi-1', index: 2, queue: [] }));
        expect(seen).toContain('playing');

        // A NEW subscriber gets the cached snapshot replayed (async, mirroring the engine).
        const replayed: Array<{ status: string; index: number }> = [];
        handle.subscribe((s) => { replayed.push({ status: s.status, index: s.index }); });
        await vi.waitFor(() => expect(replayed).toHaveLength(1));
        expect(replayed[0]).toEqual({ status: 'playing', index: 2 });
        // snapshot() serves the same state synchronously.
        expect(handle.snapshot().status).toBe('playing');
        expect(handle.snapshot().index).toBe(2);
    });

    it('drops out-of-order deliveries by seq (Comlink reordering guard)', async () => {
        const handle = new WorkerEngineHandle();
        const client = makeFakeClient();
        clientState.resolve!(client);
        await handle.whenReady();

        const seen: number[] = [];
        handle.subscribe((s) => { seen.push(s.seq); });

        clientState.subscribeListener!(snap({ seq: 5, status: 'playing', queue: [] }));
        clientState.subscribeListener!(snap({ seq: 3, status: 'stopped', queue: [] })); // stale — dropped
        clientState.subscribeListener!(snap({ seq: 6, status: 'paused' }));

        expect(seen).toEqual([5, 6]);
        expect(handle.snapshot().status).toBe('paused');
    });

    it('re-attaches the cached queue when a broadcast omits it (unchanged queueId)', async () => {
        const handle = new WorkerEngineHandle();
        const client = makeFakeClient();
        clientState.resolve!(client);
        await handle.whenReady();

        const queues: Array<ReadonlyArray<unknown> | undefined> = [];
        handle.subscribe((s) => { queues.push(s.queue); });

        const theQueue = [{ text: 'one', cfi: 'c1' }];
        clientState.subscribeListener!(snap({ seq: 1, status: 'loading', queueId: 'q9', queue: theQueue }));
        clientState.subscribeListener!(snap({ seq: 2, status: 'playing', queueId: 'q9' })); // queue omitted

        expect(queues).toHaveLength(2);
        // Identity-preserving: the omitted-queue broadcast re-delivers the SAME array.
        expect(queues[1]).toBe(theQueue);
        expect(handle.snapshot().queue).toBe(theQueue);
    });

    it('surfaces a rejected fire-and-forget command as a TTS_COMMAND_FAILED snapshot', async () => {
        const handle = new WorkerEngineHandle();
        const client = makeFakeClient();
        client.engine.play.mockRejectedValueOnce(new Error('worker exploded'));
        clientState.resolve!(client);
        await handle.whenReady();

        const errors: Array<PlaybackSnapshot['error']> = [];
        handle.subscribe((s) => { errors.push(s.error); });

        void handle.play();

        await vi.waitFor(() => expect(errors.some((e) => e?.code === 'TTS_COMMAND_FAILED')).toBe(true));
        const failed = errors.find((e) => e?.code === 'TTS_COMMAND_FAILED');
        expect(failed?.message).toContain('worker exploded');
    });

    it('unsubscribe stops delivery', async () => {
        const handle = new WorkerEngineHandle();
        const client = makeFakeClient();
        clientState.resolve!(client);
        await handle.whenReady();

        const seen: string[] = [];
        const unsub = handle.subscribe((s) => { seen.push(s.status); });
        await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0)); // replay
        unsub();

        clientState.subscribeListener!(snap({ seq: 1, status: 'playing', queue: [] }));
        expect(seen).not.toContain('playing');
    });

    it('routes setProviderById and setBookId through the client', async () => {
        const handle = new WorkerEngineHandle();
        const client = makeFakeClient();
        clientState.resolve!(client);
        await handle.whenReady();

        void handle.setProviderById('google');
        handle.setBookId('book-1');

        await vi.waitFor(() => expect(client.engine.setProviderById).toHaveBeenCalledWith('google'));
        await vi.waitFor(() => expect(client.setBook).toHaveBeenCalledWith('book-1'));
    });

    it('routes relative seek and absolute seekTo to DISTINCT engine methods', async () => {
        // Regression: the OS media-notification scrubber drag emits an absolute `seekto`
        // (seconds). It must reach engine.seekTo(), not the relative engine.seek() — whose
        // offset only carries a sign (sentence-step navigation). Conflating the two was the
        // "dragging the slider does nothing" bug.
        const handle = new WorkerEngineHandle();
        const client = makeFakeClient();
        clientState.resolve!(client);
        await handle.whenReady();

        void handle.seek(15);
        void handle.seekTo(42.5);

        await vi.waitFor(() => expect(client.engine.seek).toHaveBeenCalledWith(15));
        await vi.waitFor(() => expect(client.engine.seekTo).toHaveBeenCalledWith(42.5));
        expect(client.engine.seekTo).not.toHaveBeenCalledWith(15);
    });

    it('request/response calls await the booted client (getVoices)', async () => {
        const handle = new WorkerEngineHandle();
        const client = makeFakeClient();

        const voicesPromise = handle.getVoices();
        clientState.resolve!(client);

        expect(await voicesPromise).toEqual([{ id: 'v1', name: 'V', lang: 'en', provider: 'local' }]);
    });
});

describe('WorkerEngineHandle (no Worker: jsdom/SSR disabled mode)', () => {
    it('is a benign no-op engine that still reports ready', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((globalThis as any).Worker).toBeUndefined();
        const handle = new WorkerEngineHandle();

        // Ready immediately; commands and queries short-circuit.
        await handle.whenReady();
        await handle.play();
        expect(await handle.getVoices()).toEqual([]);
        expect(await handle.skipToNextSection()).toBe(false);

        // subscribe delivers the cached 'stopped' snapshot.
        const seen: string[] = [];
        handle.subscribe((s) => { seen.push(s.status); });
        await vi.waitFor(() => expect(seen).toEqual(['stopped']));
        expect(handle.snapshot().queue).toEqual([]);
    });
});
