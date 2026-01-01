export class TaskSequencer {
  private pendingPromise: Promise<void> = Promise.resolve();
  private isDestroyed = false;

  enqueue<T>(task: () => Promise<T>): Promise<T | void> {
    const resultPromise = this.pendingPromise.then(async () => {
      if (this.isDestroyed) return;
      try {
        return await task();
      } catch (err) {
        console.error("Audio task failed safely:", err);
      }
    });

    // Ensure the main chain always resolves successfully so next task runs
    this.pendingPromise = resultPromise.then(() => {}).catch(() => {});

    return resultPromise;
  }

  destroy() {
    this.isDestroyed = true;
  }
}
