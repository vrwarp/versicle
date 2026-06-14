/**
 * RingRecorder — the generic, dependency-free ring-buffer event core of the
 * flight-recorder family (Phase 5b; phase5-tts-strangler.md §5b.6 / N7).
 *
 * Kernel admission (master plan §2 rule 1): this module imports NOTHING
 * internal — the event shape is a structural generic so domain wrappers
 * (TTSFlightRecorder today; reader/sync recorders in P6/P7) can bind their
 * own source unions and persistence. Everything domain-specific — anomaly
 * heuristics, snapshot assembly, IndexedDB persistence — stays in the
 * wrapper.
 *
 * Hot-path discipline: `record()` is a fixed-cost append (ring overwrite,
 * string truncation); no allocation beyond the event object itself.
 */

/** Primitive payload values; long strings are truncated by the recorder. */
export type RingEventData = Record<string, string | number | boolean | null | undefined>;

/** A single recorded event. Structurally compatible with ~types FlightEvent. */
export interface RingEvent<S extends string = string> {
    /** Sequential identifier to ensure ordering even with identical timestamps. */
    seq: number;
    /** Monotonic performance timestamp (ms). */
    ts: number;
    /** Wall-clock timestamp (Unix ms). */
    wall: number;
    /** The subsystem that generated the event. */
    src: S;
    /** The specific event name. */
    ev: string;
    /** Optional truncated payload. */
    d?: RingEventData;
}

export interface RingRecorderStats {
    eventCount: number;
    capacity: number;
    oldestWall: number | null;
}

export interface RingRecorderOptions {
    /** Ring capacity (events). */
    capacity?: number;
    /** Per-string payload truncation length. */
    maxStringLength?: number;
}

const DEFAULT_CAPACITY = 2000;
const DEFAULT_MAX_STRING_LEN = 80;

export class RingRecorder<S extends string = string> {
    private readonly capacity: number;
    private readonly maxStringLength: number;
    private buffer: RingEvent<S>[] = [];
    private seq = 0;
    private head = 0;
    private full = false;

    constructor(options: RingRecorderOptions = {}) {
        this.capacity = options.capacity ?? DEFAULT_CAPACITY;
        this.maxStringLength = options.maxStringLength ?? DEFAULT_MAX_STRING_LEN;
    }

    /** Record an event. Hot path — must be fast. Returns the recorded event. */
    record(src: S, ev: string, data?: RingEventData): RingEvent<S> {
        const event: RingEvent<S> = {
            seq: this.seq++,
            ts: performance.now(),
            wall: Date.now(),
            src,
            ev,
        };

        if (data) {
            const d: RingEventData = {};
            for (const key in data) {
                const val = data[key];
                d[key] = typeof val === 'string' && val.length > this.maxStringLength
                    ? val.slice(0, this.maxStringLength)
                    : val;
            }
            event.d = d;
        }

        if (this.full) {
            this.buffer[this.head] = event;
        } else {
            this.buffer.push(event);
        }

        this.head = (this.head + 1) % this.capacity;
        if (this.head === 0 && !this.full) this.full = true;

        return event;
    }

    /** Export events in chronological order. */
    export(): RingEvent<S>[] {
        if (!this.full) return this.buffer.slice();
        return [
            ...this.buffer.slice(this.head),
            ...this.buffer.slice(0, this.head),
        ];
    }

    /** Buffer stats for UIs / exports. */
    getStats(): RingRecorderStats {
        const events = this.export();
        return {
            eventCount: events.length,
            capacity: this.capacity,
            oldestWall: events[0]?.wall ?? null,
        };
    }

    /** Clear the live buffer (sequence numbers restart too). */
    clear(): void {
        this.buffer = [];
        this.head = 0;
        this.full = false;
        this.seq = 0;
    }
}
