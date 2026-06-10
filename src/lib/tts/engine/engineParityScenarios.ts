/**
 * The engine behavioral contract, written once and run against BOTH transports:
 *   - in-process: AudioPlayerService driven directly (engineParity.inprocess.test.ts)
 *   - worker:     the same engine behind WorkerTtsEngine over a MessageChannel + Comlink
 *                 (engineParity.worker.test.ts) — the exact wiring of the production worker,
 *                 minus OS-thread isolation.
 *
 * Identical assertions on both sides are the parity guarantee for the bridge: any behavioral
 * drift between the transports fails one side of the suite. Scenarios poll with vi.waitFor so
 * the same code tolerates the worker transport's async message hops.
 */
import { describe, it, expect, vi } from 'vitest';
import type { TTSVoice } from '../providers/types';
import type { TTSQueueItem } from '../AudioPlayerService';

export interface ParitySnapshot {
    status: string;
    index: number;
    queueLen: number;
    error: string | null;
}

export interface ParityHarness {
    engine: {
        setQueue(items: TTSQueueItem[], startIndex: number): Promise<void> | void;
        play(): Promise<void>;
        pause(): Promise<void> | void;
        stop(): Promise<void> | void;
        jumpTo(index: number): Promise<void> | void;
        setVoice(voiceId: string): Promise<void> | void;
        setSpeed(speed: number): Promise<void> | void;
        setProviderById(providerId: string): Promise<void> | void;
        getVoices(): Promise<TTSVoice[]>;
    };
    backend: {
        played(): Array<{ text: string; voiceId: string; speed: number }>;
        pauseCount(): number;
        stopCount(): number;
        providerIds(): string[];
        setVoices(voices: TTSVoice[]): void;
    };
    /** Fire provider events into the engine (crosses the boundary on the worker transport). */
    fireStart(): Promise<void> | void;
    fireEnd(): Promise<void> | void;
    fireError(error: { message: string }): Promise<void> | void;
    /** All status broadcasts received so far. */
    snapshots(): ParitySnapshot[];
    dispose(): void | Promise<void>;
}

const QUEUE: TTSQueueItem[] = [
    { text: 'First sentence of the parity suite.', cfi: 'cfi-0', sourceIndices: [0] },
    { text: 'Second sentence of the parity suite.', cfi: 'cfi-1', sourceIndices: [1] },
];

export function describeEngineParity(
    transport: string,
    makeHarness: () => Promise<ParityHarness>,
): void {
    describe(`engine behavioral parity [${transport}]`, () => {
        async function withHarness(run: (h: ParityHarness) => Promise<void>) {
            const h = await makeHarness();
            try {
                await run(h);
            } finally {
                await h.dispose();
            }
        }

        it('play() synthesizes the current queue item through the backend', () =>
            withHarness(async (h) => {
                await h.engine.setQueue(QUEUE, 0);
                await h.engine.play();

                await vi.waitFor(() => expect(h.backend.played().length).toBeGreaterThan(0));
                expect(h.backend.played()[0].text).toContain('First sentence');
            }));

        it("the provider's start event drives the status to 'playing'", () =>
            withHarness(async (h) => {
                await h.engine.setQueue(QUEUE, 0);
                await h.engine.play();
                await vi.waitFor(() => expect(h.backend.played().length).toBeGreaterThan(0));

                await h.fireStart();
                await vi.waitFor(() =>
                    expect(h.snapshots().some((s) => s.status === 'playing')).toBe(true));
            }));

        it("the provider's end event advances to the next item and synthesizes it", () =>
            withHarness(async (h) => {
                await h.engine.setQueue(QUEUE, 0);
                await h.engine.play();
                await vi.waitFor(() => expect(h.backend.played().length).toBe(1));

                await h.fireStart();
                await h.fireEnd();

                await vi.waitFor(() => expect(h.backend.played().length).toBe(2));
                expect(h.backend.played()[1].text).toContain('Second sentence');
                await vi.waitFor(() =>
                    expect(h.snapshots().some((s) => s.index === 1)).toBe(true));
            }));

        it("finishing the last item completes the queue (status 'completed')", () =>
            withHarness(async (h) => {
                await h.engine.setQueue(QUEUE, 1);
                await h.engine.play();
                await vi.waitFor(() => expect(h.backend.played().length).toBe(1));

                await h.fireStart();
                await h.fireEnd();

                await vi.waitFor(() =>
                    expect(h.snapshots().some((s) => s.status === 'completed')).toBe(true));
            }));

        it("pause() reaches the backend and broadcasts 'paused'", () =>
            withHarness(async (h) => {
                await h.engine.setQueue(QUEUE, 0);
                await h.engine.play();
                await vi.waitFor(() => expect(h.backend.played().length).toBe(1));
                await h.fireStart();

                await h.engine.pause();
                await vi.waitFor(() => expect(h.backend.pauseCount()).toBe(1));
                await vi.waitFor(() =>
                    expect(h.snapshots().some((s) => s.status === 'paused')).toBe(true));
            }));

        it("stop() reaches the backend and broadcasts 'stopped'", () =>
            withHarness(async (h) => {
                await h.engine.setQueue(QUEUE, 0);
                await h.engine.play();
                await vi.waitFor(() => expect(h.backend.played().length).toBe(1));
                await h.fireStart();

                await h.engine.stop();
                await vi.waitFor(() => expect(h.backend.stopCount()).toBeGreaterThan(0));
                await vi.waitFor(() =>
                    expect(h.snapshots().some((s) => s.status === 'stopped')).toBe(true));
            }));

        it('jumpTo() plays the selected item', () =>
            withHarness(async (h) => {
                await h.engine.setQueue(QUEUE, 0);
                await h.engine.jumpTo(1);

                await vi.waitFor(() => expect(h.backend.played().length).toBeGreaterThan(0));
                const last = h.backend.played()[h.backend.played().length - 1];
                expect(last.text).toContain('Second sentence');
            }));

        it('a provider error stops playback and surfaces the error to subscribers', () =>
            withHarness(async (h) => {
                await h.engine.setQueue(QUEUE, 0);
                await h.engine.play();
                await vi.waitFor(() => expect(h.backend.played().length).toBe(1));
                await h.fireStart();

                await h.fireError({ message: 'synthesis exploded' });

                await vi.waitFor(() =>
                    expect(h.snapshots().some((s) => s.status === 'stopped')).toBe(true));
                await vi.waitFor(() =>
                    expect(h.snapshots().some((s) => s.error?.includes('synthesis exploded'))).toBe(true));
            }));

        it('getVoices() round-trips the backend voice list', () =>
            withHarness(async (h) => {
                h.backend.setVoices([{ id: 'v1', name: 'Voice 1', lang: 'en-US', provider: 'local' }]);

                const voices = await h.engine.getVoices();
                expect(voices).toEqual([{ id: 'v1', name: 'Voice 1', lang: 'en-US', provider: 'local' }]);
            }));

        it('setVoice() + setSpeed() shape the next synthesis call', () =>
            withHarness(async (h) => {
                await h.engine.setVoice('voice-9');
                await h.engine.setSpeed(1.5);
                await h.engine.setQueue(QUEUE, 0);
                await h.engine.play();

                await vi.waitFor(() => expect(h.backend.played().length).toBeGreaterThan(0));
                const call = h.backend.played()[0];
                expect(call.voiceId).toBe('voice-9');
                expect(call.speed).toBe(1.5);
            }));

        it('setProviderById() routes the provider id (plain data) to the backend', () =>
            withHarness(async (h) => {
                await h.engine.setProviderById('google');
                await vi.waitFor(() => expect(h.backend.providerIds()).toContain('google'));
            }));
    });
}
