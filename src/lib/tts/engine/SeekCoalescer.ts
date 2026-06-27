/**
 * SeekCoalescer — coalesces a BURST of absolute scrubber seeks into a single
 * settled apply. A Phase 5b decomposition sibling of {@link DragnetGesture}:
 * gesture machinery lives in its own unit, the PlaybackController FSM keeps
 * only thin hooks.
 *
 * The OS media controls (Chrome's Global Media Controls, the lock screen, a
 * Bluetooth head unit) fire a rapid stream of absolute `seekto` actions while
 * the user drags the scrubber. Applying each tick — re-deriving the queue
 * index, rebuilding lock-screen metadata (cover-artwork canvas), persisting
 * progress, pushing position state, and (when playing) re-synthesizing the
 * landed sentence — is what makes the scrubber lag.
 *
 * This unit owns the trailing-edge debounce policy ONLY: it remembers the
 * latest target (tagged with the queue identity it was scheduled against) and
 * fires {@link SeekCoalescerDeps.onSettle} ONCE the drag settles. It knows
 * nothing about the playback FSM — the controller owns the *mechanism* of
 * applying a settled seek, and owns the *validity* policy (the `queueId` tag is
 * carried through untouched for the controller to compare; see
 * `PlaybackController.isSeekStillValid`). Keeping it dep-injected and
 * FSM-agnostic is what makes it unit-testable with fake timers in isolation.
 */

/** The default trailing-edge settle window for a scrubber drag. */
export const SEEK_SETTLE_MS = 180;

/** A coalesced seek target, tagged with the queue identity it was scheduled against. */
export interface PendingSeek {
    /** Absolute target time (seconds) in the section-queue domain. */
    time: number;
    /** QueueModel.queueId at schedule time — the controller drops the seek if it changed. */
    queueId: string;
}

interface SeekCoalescerDeps {
    /** Current queue identity, captured per {@link SeekCoalescer.schedule} to tag the pending seek. */
    getQueueId(): string;
    /** Invoked ONCE when a drag settles, with the latest pending target. */
    onSettle(pending: PendingSeek): void;
    /** Trailing-edge debounce window in milliseconds. */
    settleMs: number;
}

export class SeekCoalescer {
    private pending: PendingSeek | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly deps: SeekCoalescerDeps) {}

    /**
     * Record the latest scrub target and (re)start the settle timer. Earlier
     * targets in the same burst are discarded — only the last one settles.
     */
    schedule(time: number): void {
        this.pending = { time, queueId: this.deps.getQueueId() };
        this.armTimer();
    }

    /**
     * Take the pending target NOW, cancelling the settle timer — for a command
     * (play) that takes over playback and wants to land on the dropped position
     * itself instead of racing the timer. Returns null when nothing is pending.
     * The caller validates the tag before applying it.
     */
    flush(): PendingSeek | null {
        this.clearTimer();
        const pending = this.pending;
        this.pending = null;
        return pending;
    }

    /** Drop any pending scrub without applying it (a context switch made it stale). */
    cancel(): void {
        this.clearTimer();
        this.pending = null;
    }

    private armTimer(): void {
        this.clearTimer();
        this.timer = setTimeout(() => {
            this.timer = null;
            const pending = this.pending;
            this.pending = null;
            if (pending) this.deps.onSettle(pending);
        }, this.deps.settleMs);
    }

    private clearTimer(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
