/**
 * TaskSequencer — serialized execution of the engine's asynchronous commands,
 * with epoch-based cancellation (Phase 5b; phase5-tts-strangler.md §5b.3).
 *
 * Serialize-all-mutations is the invariant the engine is built on: tasks run
 * strictly one at a time, in FIFO order, so playback state can never be
 * mutated by two interleaved commands. This class adds the cancellation
 * vocabulary on top:
 *
 *  - **Epochs**: the three context-switch commands (`stop`, `setBookId`,
 *    `loadSection`) call {@link bumpEpoch} synchronously BEFORE enqueueing
 *    themselves. Every task captures the epoch current at its enqueue time;
 *    a bump makes all previously enqueued (and the currently running) tasks
 *    *stale*.
 *  - **TaskContext**: each task receives `{signal, epoch, stale(), checkpoint()}`.
 *    `checkpoint()` throws {@link TaskCancelledError} when stale — the typed
 *    replacement for the hand-rolled `currentBookId !== originalBookId`
 *    guards (S7). A cancelled task RESOLVES void to its caller (exactly the
 *    old guard-bail semantics), and the chain continues undisturbed.
 *  - **AbortSignal**: `ctx.signal` aborts when the task's epoch is superseded
 *    (or on destroy), so long-running work (cloud fetches) can be wired to
 *    real cancellation without polling.
 *  - **Watchdog**: a task still running after {@link WATCHDOG_MS} records a
 *    `TSQ` flight-recorder anomaly (and triggers a diagnostic snapshot) —
 *    a hung task wedges the whole queue, which is precisely the failure mode
 *    the detached-persistence policy exists to avoid (see SessionStore notes
 *    in AudioPlayerService).
 *  - **isInsideTask()**: feeds the DEV assert that status/queue mutations
 *    happen only inside a running sequenced task (the C4 invariant).
 */
import { flightRecorder } from './TTSFlightRecorder';

/** Thrown by `ctx.checkpoint()` when the task's epoch has been superseded. */
export class TaskCancelledError extends Error {
    constructor(label: string, epoch: number) {
        super(`sequenced task '${label}' cancelled (epoch ${epoch} superseded)`);
        this.name = 'TaskCancelledError';
    }
}

/** Per-task cancellation context handed to every sequenced task. */
export interface TaskContext {
    /** Aborted when the task's epoch is superseded (or the sequencer is destroyed). */
    readonly signal: AbortSignal;
    /** The epoch this task was enqueued under. */
    readonly epoch: number;
    /** Whether a context-switch command (stop/setBookId/loadSection) superseded this task. */
    stale(): boolean;
    /** Throws {@link TaskCancelledError} when stale — replaces the hand-rolled book-id guards. */
    checkpoint(): void;
}

/** Tasks still running after this long record a flight-recorder anomaly. */
const WATCHDOG_MS = 30_000;

export class TaskSequencer {
    private pendingPromise: Promise<void> = Promise.resolve();
    private isDestroyed = false;
    private currentEpoch = 0;
    /** Controller for the CURRENT epoch; replaced (and the old one aborted) on bump. */
    private abortController = new AbortController();
    private insideTask = false;

    /**
     * Enqueues an asynchronous task to be executed sequentially.
     *
     * Error semantics are caller-visible and unchanged from the pre-epoch
     * sequencer: the returned promise resolves with the task's exact return
     * value, rejects with the task's exact error, and a failed task never
     * poisons the chain for subsequent tasks. A task cancelled via
     * `ctx.checkpoint()` resolves void (the legacy guard-bail behavior).
     *
     * @param label Stable task name for flight-recorder events + watchdog reports.
     * @param task The function to execute, receiving its {@link TaskContext}.
     */
    enqueue<T>(label: string, task: (ctx: TaskContext) => Promise<T>): Promise<T | void> {
        flightRecorder.record('TSQ', 'enqueue', { label });
        const epoch = this.currentEpoch;
        const signal = this.abortController.signal;
        const ctx: TaskContext = {
            signal,
            epoch,
            stale: () => epoch !== this.currentEpoch,
            checkpoint: () => {
                if (epoch !== this.currentEpoch) throw new TaskCancelledError(label, epoch);
            },
        };
        const resultPromise = this.pendingPromise.then(async () => {
            if (this.isDestroyed) {
                flightRecorder.record('TSQ', 'task.abort', { reason: 'destroyed', label });
                return;
            }
            flightRecorder.record('TSQ', 'task.start', { label, epoch, stale: ctx.stale() });
            const watchdog = setTimeout(() => {
                flightRecorder.record('TSQ', 'task.watchdog', { label, epoch, ms: WATCHDOG_MS });
                void flightRecorder.snapshot(
                    'anomaly:task_watchdog',
                    `sequenced task '${label}' still running after ${WATCHDOG_MS}ms`,
                );
            }, WATCHDOG_MS);
            this.insideTask = true;
            try {
                const res = await task(ctx);
                flightRecorder.record('TSQ', 'task.done', { label });
                return res;
            } catch (e) {
                if (e instanceof TaskCancelledError) {
                    // Cancellation is an outcome, not a failure: resolve void
                    // (the legacy hand-rolled guards `return`ed the same way).
                    flightRecorder.record('TSQ', 'task.cancelled', { label, epoch });
                    return;
                }
                flightRecorder.record('TSQ', 'task.error', { label, error: String(e) });
                throw e;
            } finally {
                this.insideTask = false;
                clearTimeout(watchdog);
            }
        });

        this.pendingPromise = resultPromise.then(() => { }).catch((err) => {
            console.error("TaskSequencer task failed safely:", err);
        });
        return resultPromise as Promise<T | void>;
    }

    /**
     * Advance the epoch, making every previously enqueued (and the currently
     * running) task stale and aborting their shared AbortSignal. Called
     * synchronously by the three context-switch commands BEFORE they enqueue
     * themselves — their own task then carries the fresh epoch.
     */
    bumpEpoch(reason: string): void {
        this.currentEpoch++;
        flightRecorder.record('TSQ', 'epoch.bump', { reason, epoch: this.currentEpoch });
        this.abortController.abort(new TaskCancelledError(`epoch:${reason}`, this.currentEpoch - 1));
        this.abortController = new AbortController();
    }

    /**
     * Whether a sequenced task is currently executing (incl. suspended at an
     * await). Feeds the DEV assert that status/queue mutations happen only
     * inside sequenced tasks; single-threaded JS cannot attribute ownership
     * exactly, so this is a structural tripwire, not a proof.
     */
    isInsideTask(): boolean {
        return this.insideTask;
    }

    /**
     * Marks the sequencer as destroyed, preventing any further pending tasks
     * from executing, and aborts the current epoch's signal.
     */
    destroy() {
        this.isDestroyed = true;
        this.abortController.abort(new TaskCancelledError('destroy', this.currentEpoch));
    }
}
