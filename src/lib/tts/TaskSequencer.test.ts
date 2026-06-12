/**
 * TaskSequencer invariant suite (Phase 5b-PR3; phase5-tts-strangler.md §5b.3).
 *
 * Extends the original FIFO/error-isolation suite with the epoch-cancellation
 * semantics, and carries the named regression blocks for the per-bug files it
 * absorbed (absorption ledger rows 2/4/5/15):
 *   - TaskSequencer_Predictability.test.ts  → describe('regression: TaskSequencer_Predictability')
 *   - AudioPlayerService_Concurrency.test.ts → describe('regression: AudioPlayerService_Concurrency')
 *   - AudioPlayerService_Critical.test.ts    → describe('regression: AudioPlayerService_Critical')
 * The engine-level halves of those suites (rapid jumpTo routing, stale-book
 * no-ops) live in the parity scenarios (P17/P18 + the predictability
 * regression block in engineParity.inprocess.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskSequencer, TaskCancelledError, type TaskContext } from './TaskSequencer';

describe('TaskSequencer', () => {
    let sequencer: TaskSequencer;

    beforeEach(() => {
        sequencer = new TaskSequencer();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should execute tasks sequentially', async () => {
        const results: number[] = [];
        const task1 = () => new Promise<void>(resolve => setTimeout(() => { results.push(1); resolve(); }, 50));
        const task2 = () => new Promise<void>(resolve => setTimeout(() => { results.push(2); resolve(); }, 10));

        const p1 = sequencer.enqueue('t1', task1);
        const p2 = sequencer.enqueue('t2', task2);

        await Promise.all([p1, p2]);
        expect(results).toEqual([1, 2]);
    });

    it('should handle task failures safely', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const results: number[] = [];
        const task1 = () => new Promise<void>((_, reject) => setTimeout(() => reject('error'), 10));
        const task2 = () => new Promise<void>(resolve => { results.push(2); resolve(); });

        const p1 = sequencer.enqueue('t1', task1);
        const p2 = sequencer.enqueue('t2', task2);

        try {
            await p1;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (_e) {
            // caller can catch the error
        }
        await p2;

        expect(results).toEqual([2]);
    });

    it('should not execute tasks after destruction', async () => {
        const results: number[] = [];
        const task1 = async () => { results.push(1); };

        sequencer.destroy();
        await sequencer.enqueue('t1', task1);

        expect(results).toEqual([]);
    });

    describe('epochs & cancellation (§5b.3)', () => {
        it('a task enqueued before a bump observes stale() and checkpoint() throws; one enqueued after does not', async () => {
            const observed: Array<{ label: string; stale: boolean }> = [];
            let release!: () => void;
            const gate = new Promise<void>((r) => { release = r; });

            const before = sequencer.enqueue('before', async (ctx) => {
                await gate; // suspended while the bump happens
                observed.push({ label: 'before', stale: ctx.stale() });
                ctx.checkpoint(); // must throw — superseded
                observed.push({ label: 'before.after-checkpoint', stale: ctx.stale() });
            });

            sequencer.bumpEpoch('test');

            const after = sequencer.enqueue('after', async (ctx) => {
                observed.push({ label: 'after', stale: ctx.stale() });
                ctx.checkpoint(); // must NOT throw — fresh epoch
            });

            release();
            await Promise.all([before, after]);

            expect(observed).toEqual([
                { label: 'before', stale: true },
                { label: 'after', stale: false },
            ]);
        });

        it('a cancelled task RESOLVES void to its caller (legacy guard-bail semantics) and never poisons the chain', async () => {
            const before = sequencer.enqueue('stale', async (ctx) => {
                ctx.checkpoint();
                return 'never';
            });
            sequencer.bumpEpoch('test');

            await expect(before).resolves.toBeUndefined();
            await expect(sequencer.enqueue('next', async () => 'ran')).resolves.toBe('ran');
        });

        it('bumpEpoch aborts the superseded epoch’s AbortSignal; the new epoch’s signal is live', async () => {
            let staleSignal!: AbortSignal;
            const p = sequencer.enqueue('holder', async (ctx) => {
                staleSignal = ctx.signal;
            });
            await p;
            expect(staleSignal.aborted).toBe(false);

            sequencer.bumpEpoch('test');
            expect(staleSignal.aborted).toBe(true);
            expect(staleSignal.reason).toBeInstanceOf(TaskCancelledError);

            await sequencer.enqueue('fresh', async (ctx) => {
                expect(ctx.signal.aborted).toBe(false);
            });
        });

        it('isInsideTask() is true exactly while a task runs (incl. suspended at an await)', async () => {
            expect(sequencer.isInsideTask()).toBe(false);
            let duringAwait = false;
            const p = sequencer.enqueue('probe', async () => {
                await new Promise<void>((r) => setTimeout(() => {
                    duringAwait = sequencer.isInsideTask();
                    r();
                }, 0));
            });
            await p;
            expect(duringAwait).toBe(true);
            expect(sequencer.isInsideTask()).toBe(false);
        });

        it('a task hung past the watchdog deadline records a TSQ anomaly', async () => {
            vi.useFakeTimers();
            const { flightRecorder } = await import('./TTSFlightRecorder');
            const recordSpy = vi.spyOn(flightRecorder, 'record');
            const snapshotSpy = vi.spyOn(flightRecorder, 'snapshot').mockResolvedValue(null);

            let release!: () => void;
            const p = sequencer.enqueue('hung', async () => {
                await new Promise<void>((r) => { release = r; });
            });

            await vi.advanceTimersByTimeAsync(30_000);
            expect(recordSpy).toHaveBeenCalledWith('TSQ', 'task.watchdog',
                expect.objectContaining({ label: 'hung', ms: 30_000 }));
            expect(snapshotSpy).toHaveBeenCalledWith('anomaly:task_watchdog', expect.stringContaining('hung'));

            release();
            await p;
            vi.useRealTimers();
        });

        it('a completed task does NOT fire the watchdog later', async () => {
            vi.useFakeTimers();
            const { flightRecorder } = await import('./TTSFlightRecorder');
            const recordSpy = vi.spyOn(flightRecorder, 'record');

            await sequencer.enqueue('quick', async () => {});
            await vi.advanceTimersByTimeAsync(60_000);

            const watchdogCalls = recordSpy.mock.calls.filter(([, ev]) => ev === 'task.watchdog');
            expect(watchdogCalls).toHaveLength(0);
            vi.useRealTimers();
        });
    });

    describe('regression: TaskSequencer_Predictability', () => {
        it('returns a promise that allows caller to await task completion and receive its exact return value', async () => {
            const result = await sequencer.enqueue('t1', async () => 'hello');
            expect(result).toBe('hello');
        });

        it('returns a promise that rejects if the task throws, allowing the caller to handle the specific error', async () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const task1 = async () => {
                throw new Error('Specific Error');
            };

            let caught = false;
            try {
                await sequencer.enqueue('t1', task1);
            } catch (e: unknown) {
                caught = true;
                if (e instanceof Error) {
                    expect(e.message).toBe('Specific Error');
                }
            }

            // wait for background promise in TaskSequencer to reject
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(caught).toBe(true);
            consoleErrorSpy.mockRestore();
        });
    });

    describe('regression: AudioPlayerService_Concurrency', () => {
        // The deleted suite drove rapid jumpTo/play/stop through the full
        // engine and asserted the FINAL state — i.e. exactly the sequencer
        // guarantees re-stated at engine level: serialized FIFO execution and
        // last-command-wins. Those guarantees are pinned here directly; the
        // engine-level routing (jumpTo plays the selected item, stop broadcasts
        // 'stopped') is pinned by parity P7 and the pause/stop scenarios.
        it('rapid commands execute serially in order — the last one decides the final state', async () => {
            let state = -1;
            const order: number[] = [];
            const command = (i: number) => sequencer.enqueue(`cmd${i}`, async () => {
                await new Promise((r) => setTimeout(r, 5));
                order.push(i);
                state = i;
            });

            await Promise.all([command(0), command(1), command(2)]);
            expect(order).toEqual([0, 1, 2]);
            expect(state).toBe(2);
        });

        it('stop-after-play wins: a stop enqueued after a play runs after it (or cancels it via the epoch)', async () => {
            const ran: string[] = [];
            const play = sequencer.enqueue('play', async (ctx: TaskContext) => {
                ctx.checkpoint(); // engine play() checkpoints at task start
                ran.push('play');
            });
            sequencer.bumpEpoch('stop'); // engine stop() bumps before enqueueing itself
            const stop = sequencer.enqueue('stop', async () => {
                ran.push('stop');
            });

            await Promise.all([play, stop]);
            // The stale play cancelled; the stop ran — final state is stopped
            // either way, with no replay racing the stop.
            expect(ran).toEqual(['stop']);
        });
    });

    describe('regression: AudioPlayerService_Critical', () => {
        it('setQueue is NOT aborted by an immediately following play (no preemption between tasks)', async () => {
            let queue: string[] = [];
            let played: string | null = null;

            const setQueue = sequencer.enqueue('setQueue', async () => {
                await new Promise((r) => setTimeout(r, 10)); // a slow critical section
                queue = ['Item 1'];
            });
            const play = sequencer.enqueue('play', async (ctx: TaskContext) => {
                ctx.checkpoint(); // play does checkpoint — but nothing bumped, so it proceeds
                played = queue[0] ?? null;
            });

            await Promise.all([setQueue, play]);
            expect(queue).toEqual(['Item 1']);
            expect(played).toBe('Item 1');
        });

        it('a second setQueue waits for the first; the last one wins', async () => {
            const writes: string[] = [];
            let release!: () => void;
            const gate = new Promise<void>((r) => { release = r; });

            const a = sequencer.enqueue('setQueueA', async () => {
                await gate;
                writes.push('A');
            });
            const b = sequencer.enqueue('setQueueB', async () => {
                writes.push('B');
            });

            release();
            await Promise.all([a, b]);
            expect(writes).toEqual(['A', 'B']);
        });
    });
});
