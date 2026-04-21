/**
 * Manages the serialization of asynchronous tasks to prevent race conditions.
 * Ensures that tasks are executed one after another in the order they were enqueued.
 * This is crucial for maintaining consistent state in the audio player during rapid user interactions.
 */
export class TaskSequencer {
    private pendingPromise: Promise<void> = Promise.resolve();
    private isDestroyed = false;

    /**
     * Enqueues an asynchronous task to be executed sequentially.
     *
     * @template T The return type of the task.
     * @param {() => Promise<T>} task The function to execute.
     * @returns {Promise<T | void>} A promise that resolves with the task's result or void if the sequencer is destroyed or the task fails safely.
     */
    enqueue<T>(task: () => Promise<T>): Promise<T | void> {
        return new Promise<T | void>((resolve, reject) => {
            this.pendingPromise = this.pendingPromise.then(async () => {
                if (this.isDestroyed) {
                    resolve(undefined);
                    return;
                }
                try {
                    const result = await task();
                    resolve(result);
                } catch (e) {
                    reject(e);
                }
            }).catch((err) => {
                // Ignore errors for the internal queue progression so it doesn't halt
                console.error("TaskSequencer task failed safely:", err);
            });
        });
    }

    /**
     * Marks the sequencer as destroyed, preventing any further pending tasks from executing.
     */
    destroy() {
        this.isDestroyed = true;
    }
}
