/**
 * Unit tests for WorkerEngineHandle — the app-facing adapter over the async worker client.
 * Covers the boot-buffering contract, whenReady, subscribe replay/fan-out, command routing,
 * and the jsdom/SSR `disabled` no-op mode.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PlaybackListener } from '../AudioPlayerService';

const { clientState } = vi.hoisted(() => ({
    clientState: {
        // Deferred so tests control when the "worker" finishes booting.
        resolve: undefined as undefined | ((c: unknown) => void),
        reject: undefined as undefined | ((e: unknown) => void),
        client: undefined as undefined | Record<string, unknown>,
        subscribeListener: undefined as undefined | PlaybackListener,
    },
}));

vi.mock('./createWorkerEngineClient', () => ({
    createWorkerEngineClient: vi.fn(() => new Promise((resolve, reject) => {
        clientState.resolve = resolve;
        clientState.reject = reject;
    })),
}));

import { WorkerEngineHandle } from './WorkerEngineHandle';

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
    };
    const client = {
        engine,
        subscribe: vi.fn(async (listener: PlaybackListener) => {
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
        clientState.resolve = undefined;
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

    it('fans status updates out to subscribers and replays the latest snapshot on subscribe', async () => {
        const handle = new WorkerEngineHandle();
        const client = makeFakeClient();
        clientState.resolve!(client);
        await handle.whenReady();

        const seen: string[] = [];
        handle.subscribe((status) => { seen.push(status); });

        // The internal subscription delivers a live update → fan-out.
        clientState.subscribeListener!('playing', 'cfi-1', 2, [], null, undefined);
        expect(seen).toContain('playing');

        // A NEW subscriber gets the cached snapshot replayed (async, mirroring the engine).
        const replayed: Array<{ status: string; index: number }> = [];
        handle.subscribe((status, _cfi, index) => { replayed.push({ status, index }); });
        await vi.waitFor(() => expect(replayed).toHaveLength(1));
        expect(replayed[0]).toEqual({ status: 'playing', index: 2 });
    });

    it('unsubscribe stops delivery', async () => {
        const handle = new WorkerEngineHandle();
        const client = makeFakeClient();
        clientState.resolve!(client);
        await handle.whenReady();

        const seen: string[] = [];
        const unsub = handle.subscribe((status) => { seen.push(status); });
        await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0)); // replay
        unsub();

        clientState.subscribeListener!('playing', null, 0, [], null, undefined);
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
        handle.subscribe((status) => { seen.push(status); });
        await vi.waitFor(() => expect(seen).toEqual(['stopped']));
    });
});
