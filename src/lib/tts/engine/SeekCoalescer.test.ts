/**
 * SeekCoalescer unit suite — the trailing-edge debounce policy in isolation,
 * driven with fake timers (no PlaybackController, no provider). The
 * controller-level behavior (lag coalescing, dragnet suppression, queueId
 * invalidation) is pinned as an integration guard in PlaybackController.test.ts.
 *
 * ZERO vi.mock (the engine-dir allowlist is empty): the unit takes plain
 * injected deps, so the suite uses a vi.fn callback + a mutable queueId closure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SeekCoalescer, SEEK_SETTLE_MS, type PendingSeek } from './SeekCoalescer';

describe('SeekCoalescer', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    function make(settleMs = 100) {
        let queueId = 'q1';
        const onSettle = vi.fn();
        const coalescer = new SeekCoalescer({ getQueueId: () => queueId, onSettle, settleMs });
        return { coalescer, onSettle, setQueueId: (id: string) => { queueId = id; } };
    }

    it('exports a positive default settle window', () => {
        expect(SEEK_SETTLE_MS).toBeGreaterThan(0);
    });

    it('coalesces a burst into ONE onSettle carrying the LAST target', () => {
        const { coalescer, onSettle } = make(100);
        coalescer.schedule(1);
        coalescer.schedule(2);
        coalescer.schedule(3);

        expect(onSettle).not.toHaveBeenCalled(); // nothing until the window elapses
        vi.advanceTimersByTime(100);

        expect(onSettle).toHaveBeenCalledTimes(1);
        expect(onSettle.mock.calls[0][0].time).toBe(3);
    });

    it('settles a full window after the LAST schedule, not the first (trailing edge)', () => {
        const { coalescer, onSettle } = make(100);
        coalescer.schedule(1);
        vi.advanceTimersByTime(80); // almost there...
        coalescer.schedule(2);      // ...restarts the window
        vi.advanceTimersByTime(80); // 160ms elapsed total, but only 80 since the last
        expect(onSettle).not.toHaveBeenCalled();
        vi.advanceTimersByTime(20); // now a full 100 since the last schedule
        expect(onSettle).toHaveBeenCalledTimes(1);
        expect(onSettle.mock.calls[0][0].time).toBe(2);
    });

    it('tags the pending seek with the queueId captured at schedule time', () => {
        const { coalescer, onSettle, setQueueId } = make(100);
        setQueueId('qA');
        coalescer.schedule(5);
        setQueueId('qB'); // a later queue change does NOT retag the already-scheduled seek
        vi.advanceTimersByTime(100);
        expect(onSettle.mock.calls[0][0]).toEqual<PendingSeek>({ time: 5, queueId: 'qA' });
    });

    it('flush() returns the pending seek and cancels the timer (no later onSettle)', () => {
        const { coalescer, onSettle } = make(100);
        coalescer.schedule(7);
        expect(coalescer.flush()).toEqual<PendingSeek>({ time: 7, queueId: 'q1' });
        vi.advanceTimersByTime(500);
        expect(onSettle).not.toHaveBeenCalled();
    });

    it('flush() returns null when nothing is pending', () => {
        expect(make().coalescer.flush()).toBeNull();
    });

    it('cancel() drops a pending seek (no onSettle, nothing left to flush)', () => {
        const { coalescer, onSettle } = make(100);
        coalescer.schedule(9);
        coalescer.cancel();
        vi.advanceTimersByTime(500);
        expect(onSettle).not.toHaveBeenCalled();
        expect(coalescer.flush()).toBeNull();
    });

    it('is reusable: a fresh schedule after a settle fires again', () => {
        const { coalescer, onSettle } = make(100);
        coalescer.schedule(1);
        vi.advanceTimersByTime(100);
        coalescer.schedule(2);
        vi.advanceTimersByTime(100);
        expect(onSettle).toHaveBeenCalledTimes(2);
        expect(onSettle.mock.calls[1][0].time).toBe(2);
    });
});
