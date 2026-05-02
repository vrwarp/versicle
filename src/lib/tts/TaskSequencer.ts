/**
 * Manages the serialization of asynchronous tasks to prevent race conditions.
 * Ensures that tasks are executed one after another in the order they were enqueued.
 * This is crucial for maintaining consistent state in the audio player during rapid user interactions.
 */
import { flightRecorder } from './TTSFlightRecorder';

export class TaskSequencer {
    private pendingPromise: Promise<void> = Promise.resolve();
    private isDestroyed = false;

    /**
     * Enqueues an asynchronous task to be executed sequentially.
     *
     * @template T The return type of the task.
     * @param {() => Promise<T>} task The function to execute.
     * @returns {Promise<T>} A promise that resolves with the task's result.
     */
    enqueue<T>(task: () => Promise<T>): Promise<T> {
        flightRecorder.record('TSQ', 'enqueue');
        const resultPromise = this.pendingPromise.then(async () => {
            if (this.isDestroyed) {
                flightRecorder.record('TSQ', 'task.abort', { reason: 'destroyed' });
                throw new Error('TaskSequencer is destroyed');
            }
            flightRecorder.record('TSQ', 'task.start');
            try {
                const res = await task();
                flightRecorder.record('TSQ', 'task.done');
                return res;
            } catch (e) {
                flightRecorder.record('TSQ', 'task.error', { error: String(e) });
                throw e;
            }
        });

        this.pendingPromise = resultPromise.then(() => { }).catch(() => {
            // we catch the error here to ensure the queue continues processing
            // without failing the entire chain
        });

        return resultPromise as Promise<T>;
    }

    /**
     * Marks the sequencer as destroyed, preventing any further pending tasks from executing.
     */
    destroy() {
        this.isDestroyed = true;
    }
}
