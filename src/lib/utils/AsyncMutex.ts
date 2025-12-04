/**
 * A simple async mutex to ensure exclusive execution of async tasks.
 * While a task is running, other tasks requesting the lock will wait in a queue.
 */
export class AsyncMutex {
    private mutex = Promise.resolve();

    /**
     * Executes the given task exclusively.
     * If the mutex is locked, the task waits until it is released.
     * @param execution The async function to execute.
     * @returns A promise resolving to the result of the task.
     */
    runExclusive<T>(execution: () => Promise<T>): Promise<T> {
        let release: () => void;
        const next = new Promise<void>((resolve) => {
            release = resolve;
        });

        const previous = this.mutex;
        this.mutex = next;

        return previous.then(() => {
            return execution().finally(() => release());
        });
    }

    /**
     * Note: This simple implementation cannot reliably tell if it's "currently" locked
     * without race conditions, but for our use case (queueing), we rely on the promise chain.
     */
}
