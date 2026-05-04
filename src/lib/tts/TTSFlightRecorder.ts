import { v4 as uuid } from 'uuid';
import { getDB } from '../../db/db';
import type { 
    FlightEventSource, 
    FlightEvent, 
    FlightSnapshot 
} from '../../types/db';

const MAX_EVENTS = 2000;
const MAX_STRING_LEN = 80;
const MAX_SNAPSHOTS = 10;

/**
 * Lightweight ring-buffer based event tracer for the TTS subsystem.
 */

export type ContextProvider = () => {
    bookId: string | null;
    sectionIndex: number;
    currentIndex: number;
    queueLength: number;
    status: string;
    /** Number of items in the queue with isSkipped=true. Populated for diagnostics. */
    skippedCount?: number;
    /** Whether the item immediately after currentIndex is skipped. */
    nextItemSkipped?: boolean | undefined;
};

/**
 * Lightweight ring-buffer based event tracer for the TTS subsystem.
 */
class TTSFlightRecorder {
    private buffer: FlightEvent[] = [];
    private seq = 0;
    private head = 0;
    private full = false;
    private contextProvider: ContextProvider | null = null;

    /**
     * Optional callback invoked synchronously when an anomaly is detected,
     * BEFORE the snapshot is taken. This allows the caller (AudioPlayerService)
     * to emit detailed diagnostic events that get captured in the snapshot.
     */
    onAnomalyDetected: ((currentIndex: number, queueLen: number) => void) | null = null;

    /** Register a callback that provides current playback context for snapshots. */
    setContextProvider(provider: ContextProvider) {
        this.contextProvider = provider;
    }

    /** Record an event. Hot path — must be fast. */
    record(src: FlightEventSource, ev: string, data?: Record<string, string | number | boolean | null | undefined>) {
        const event: FlightEvent = {
            seq: this.seq++,
            ts: performance.now(),
            wall: Date.now(),
            src,
            ev,
        };

        if (data) {
            const d: Record<string, string | number | boolean | null | undefined> = {};
            for (const key in data) {
                const val = data[key];
                d[key] = typeof val === 'string' && val.length > MAX_STRING_LEN
                    ? val.slice(0, MAX_STRING_LEN)
                    : val;
            }
            event.d = d;
        }

        if (this.full) {
            this.buffer[this.head] = event;
        } else {
            this.buffer.push(event);
        }

        this.head = (this.head + 1) % MAX_EVENTS;
        if (this.head === 0 && !this.full) this.full = true;

        // Anomaly detection
        if (ev === 'playNext') {
            // Check if it's an anomaly (chapter advance far from end)
            if (data && typeof data.index === 'number' && typeof data.queueLen === 'number' && data.hasNext === false) {
                const ratio = data.index / data.queueLen;
                if (ratio < 0.8) { // Trigger if less than 80% through the chapter
                    // Invoke the anomaly callback synchronously so its diagnostic events
                    // are captured in the ring buffer BEFORE the snapshot freezes it.
                    try {
                        this.onAnomalyDetected?.(data.index as number, data.queueLen as number);
                    } catch { /* best effort */ }
                    this.snapshot('anomaly:chapter_advance', `Auto-detected premature chapter advance at ${Math.round(ratio * 100)}%`).catch(() => {});
                }
            }
        }
    }

    /** Export events in chronological order. */
    export(): FlightEvent[] {
        if (!this.full) return this.buffer.slice();
        return [
            ...this.buffer.slice(this.head),
            ...this.buffer.slice(0, this.head)
        ];
    }

    /** Get buffer stats for the UI. */
    getStats(): { eventCount: number; capacity: number; oldestWall: number | null } {
        const events = this.export();
        return {
            eventCount: events.length,
            capacity: MAX_EVENTS,
            oldestWall: events[0]?.wall ?? null
        };
    }

    /** Clear the live buffer. */
    clear() {
        this.buffer = [];
        this.head = 0;
        this.full = false;
        this.seq = 0;
    }

    // ─── Snapshot API ───

    /**
     * Take a snapshot of the current ring buffer.
     */
    async snapshot(trigger: string = 'manual', note: string = ''): Promise<string | null> {
        try {
            this.record('APS', 'snapshot', { trigger, note });

            const events = this.export();
            const eventsJSON = JSON.stringify(events);
            const context = this.contextProvider?.()
                ?? { bookId: null, sectionIndex: -1, currentIndex: -1, queueLength: 0, status: 'unknown' };

            const snap: FlightSnapshot = {
                id: uuid(),
                createdAt: Date.now(),
                trigger,
                note,
                context,
                eventCount: events.length,
                timeRange: {
                    first: events[0]?.wall ?? 0,
                    last: events[events.length - 1]?.wall ?? 0
                },
                eventsJSON,
                sizeBytes: eventsJSON.length * 2 // UTF-16 approx
            };

            await this.saveSnapshot(snap);
            return snap.id;
        } catch (e) {
            console.error('[FlightRecorder] Failed to save snapshot', e);
            return null;
        }
    }

    /** List all saved snapshots (metadata only). */
    async listSnapshots(): Promise<Omit<FlightSnapshot, 'eventsJSON'>[]> {
        try {
            const db = await getDB();
            const all = await db.getAll('flight_snapshots');
            return all
                .sort((a, b) => b.createdAt - a.createdAt)
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                .map(({ eventsJSON: _unused, ...meta }: FlightSnapshot) => meta);
        } catch (e) {
            console.error('[FlightRecorder] Failed to list snapshots', e);
            return [];
        }
    }

    /** Load a full snapshot by ID. */
    async getSnapshot(id: string): Promise<FlightSnapshot | null> {
        try {
            const db = await getDB();
            return await db.get('flight_snapshots', id) ?? null;
        } catch {
            return null;
        }
    }

    /** Share a snapshot using the app's exportFile utility. */
    async shareSnapshot(id: string) {
        const snapshot = await this.getSnapshot(id);
        if (!snapshot) return;

        const { exportFile } = await import('../export');
        const filename = `flight_${snapshot.trigger}_${new Date(snapshot.createdAt)
            .toISOString().slice(0, 16).replace(/:/g, '-')}.json`;

        await exportFile({
            filename,
            data: snapshot.eventsJSON,
            mimeType: 'application/json'
        });
    }

    /** Delete a snapshot by ID. */
    async deleteSnapshot(id: string): Promise<void> {
        try {
            const db = await getDB();
            await db.delete('flight_snapshots', id);
        } catch { /* best effort */ }
    }

    /** Delete all saved snapshots. */
    async clearSnapshots(): Promise<void> {
        try {
            const db = await getDB();
            await db.clear('flight_snapshots');
        } catch { /* best effort */ }
    }

    // ─── Internal ───

    private async saveSnapshot(snap: FlightSnapshot) {
        const db = await getDB();
        const tx = db.transaction('flight_snapshots', 'readwrite');
        const store = tx.objectStore('flight_snapshots');

        const all = await store.getAll() as FlightSnapshot[];
        if (all.length >= MAX_SNAPSHOTS) {
            all.sort((a: FlightSnapshot, b: FlightSnapshot) => a.createdAt - b.createdAt);
            const excess = all.length - MAX_SNAPSHOTS + 1;
            for (let i = 0; i < excess; i++) {
                await store.delete(all[i].id);
            }
        }

        await store.put(snap);
        await tx.done;
    }
}

export const flightRecorder = new TTSFlightRecorder();

if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__ttsFlightRecorder = flightRecorder;
}
