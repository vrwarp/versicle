import { v4 as uuid } from 'uuid';
import { diagnostics } from '@data/repos/diagnostics';
import { RingRecorder } from '@kernel/diagnostics/ringRecorder';
import type { FlightEventSource, FlightEvent, FlightSnapshot } from '~types/flight-recorder';

/**
 * TTSFlightRecorder — the audio domain's named flight recorder.
 *
 * Since 5b-PR4 the generic ring-buffer core lives in
 * src/kernel/diagnostics/ringRecorder.ts (N7: zero internal deps; further
 * consumers arrive in P6/P7); this wrapper owns everything TTS-specific —
 * the playback-context provider, the premature-chapter-advance anomaly
 * heuristic, and snapshot persistence (IndexedDB via the diagnostics repo;
 * works in both the worker and the main thread).
 *
 * Each JS context (main thread, TTS worker) has its own module instance; the
 * production engine runs in the worker, so its live buffer is exported over
 * the engine handle (TtsEngine.exportDiagnostics — the S9 fix), while the
 * persisted snapshots are shared through IndexedDB.
 */

type ContextProvider = () => {
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

/** The live-buffer export served over the engine handle (S9). */
export interface FlightRecorderExport {
    stats: { eventCount: number; capacity: number; oldestWall: number | null };
    events: FlightEvent[];
}

class TTSFlightRecorder {
    private ring = new RingRecorder<FlightEventSource>();
    private contextProvider: ContextProvider | null = null;

    /**
     * Optional callback invoked synchronously when an anomaly is detected,
     * BEFORE the snapshot is taken. This allows the caller (the engine)
     * to emit detailed diagnostic events that get captured in the snapshot.
     */
    onAnomalyDetected: ((currentIndex: number, queueLen: number) => void) | null = null;

    /** Register a callback that provides current playback context for snapshots. */
    setContextProvider(provider: ContextProvider) {
        this.contextProvider = provider;
    }

    /** Record an event. Hot path — must be fast. */
    record(src: FlightEventSource, ev: string, data?: Record<string, string | number | boolean | null | undefined>) {
        this.ring.record(src, ev, data);

        // Anomaly detection (TTS-specific heuristic; stays out of the kernel core)
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
        return this.ring.export();
    }

    /** Get buffer stats for the UI. */
    getStats(): { eventCount: number; capacity: number; oldestWall: number | null } {
        return this.ring.getStats();
    }

    /** The live-buffer export served over the engine handle (S9). */
    exportForHandle(): FlightRecorderExport {
        return { stats: this.getStats(), events: this.export() };
    }

    /** Clear the live buffer. */
    clear() {
        this.ring.clear();
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
            return await diagnostics.listSnapshots();
        } catch (e) {
            console.error('[FlightRecorder] Failed to list snapshots', e);
            return [];
        }
    }

    /** Load a full snapshot by ID. */
    async getSnapshot(id: string): Promise<FlightSnapshot | null> {
        try {
            return await diagnostics.getSnapshot(id);
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
            await diagnostics.deleteSnapshot(id);
        } catch { /* best effort */ }
    }

    /** Delete all saved snapshots. */
    async clearSnapshots(): Promise<void> {
        try {
            await diagnostics.clearSnapshots();
        } catch { /* best effort */ }
    }

    // ─── Internal ───

    private async saveSnapshot(snap: FlightSnapshot) {
        // Persistence (incl. the MAX_SNAPSHOTS prune in one gated txn) lives
        // in the diagnostics repo (P3-9).
        await diagnostics.saveSnapshot(snap);
    }
}

export const flightRecorder = new TTSFlightRecorder();

if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__ttsFlightRecorder = flightRecorder;
}
