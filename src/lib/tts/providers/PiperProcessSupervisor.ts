
/**
 * PiperProcessSupervisor
 *
 * Manages the lifecycle of the Piper TTS web worker.
 * It handles task queueing, timeouts, auto-restarts on errors, and ensures
 * that requests are processed sequentially.
 *
 * The supervisor acts as a "smart proxy" to the raw worker, adding robustness
 * against crashes (e.g. WASM memory errors) and hangs.
 */
export class PiperProcessSupervisor {
  private worker: Worker | null = null;
  private workerUrl: string | null = null;
  private isProcessing: boolean = false;
  private currentTask: {
    data: unknown;
    onMessage: (event: MessageEvent) => void;
    onError: (error: unknown) => void;
    timeoutId: ReturnType<typeof setTimeout> | null;
    retriesLeft: number;
  } | null = null;
  private queue: Array<{
    data: unknown;
    onMessage: (event: MessageEvent) => void;
    onError: (error: unknown) => void;
    timeoutMs: number;
    retries: number;
  }> = [];

  constructor() {}

  /**
   * Initializes the supervisor with the worker script URL.
   * If the URL has changed, any existing worker is terminated.
   */
  public init(workerUrl: string) {
    if (this.workerUrl !== workerUrl) {
      this.terminate();
      this.workerUrl = workerUrl;
    }
  }

  /**
   * Terminates the underlying worker and resets processing state.
   * Pending queue items are preserved.
   */
  public terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.isProcessing = false;
  }

  /**
   * Enqueues a task to be sent to the worker.
   *
   * @param data - The message payload to post to the worker.
   * @param onMessage - Callback for 'message' events from the worker during this task.
   * @param onError - Callback for errors (timeout, worker error, etc.).
   * @param timeoutMs - Max duration for the task before it is considered timed out.
   * @param retries - Number of times to retry the task if it fails (crashes/timeouts).
   */
  public send(
    data: unknown,
    onMessage: (event: MessageEvent) => void,
    onError: (error: unknown) => void,
    timeoutMs: number = 30000,
    retries: number = 1
  ) {
    this.queue.push({ data, onMessage, onError, timeoutMs, retries });
    this.processQueue();
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    if (!this.workerUrl) {
      const task = this.queue.shift();
      task?.onError(new Error("Worker URL not set. Call init() first."));
      return;
    }

    this.isProcessing = true;
    const task = this.queue.shift()!;

    this.currentTask = {
      ...task,
      retriesLeft: task.retries,
      timeoutId: null
    };

    this.runCurrentTask();
  }

  private runCurrentTask() {
    if (!this.currentTask) return;

    if (!this.worker) {
        try {
            // Initialize worker if not active.
            // Some consumers might pass workerUrl in data for legacy reasons, prefer stored one.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.worker = new Worker((this.currentTask.data as any).workerUrl || this.workerUrl!);
            this.setupWorkerListeners();
        } catch (e) {
            this.handleError(e);
            return;
        }
    }

    // Set a safety timeout for the entire task or initial response.
    this.currentTask.timeoutId = setTimeout(() => {
      this.handleError(new Error("Timeout: Worker did not respond in time"));
    }, (this.currentTask.data as { timeoutMs?: number }).timeoutMs || 30000);

    // Dispatch the message to the worker.
    this.worker.postMessage(this.currentTask.data);
  }

  private setupWorkerListeners() {
    if (!this.worker) return;

    this.worker.onmessage = (event: MessageEvent) => {
      if (this.currentTask) {
        // Reset the timeout whenever we receive a message from the worker.
        // This prevents long-running tasks (like downloads) from timing out
        // as long as they are reporting progress.
        if (this.currentTask.timeoutId) {
            clearTimeout(this.currentTask.timeoutId);
            this.currentTask.timeoutId = setTimeout(() => {
                this.handleError(new Error("Timeout: Worker stalled"));
            }, 30000);
        }

        try {
            this.currentTask.onMessage(event);
        } catch (e) {
            console.error("Error in onMessage handler:", e);
        }

        // Determine if the task is complete based on message type.
        // 'complete': Standard Piper completion signal.
        // 'isAlive' (false): Health check response indicating restart needed.
        if (event.data.kind === 'complete' || (event.data.kind === 'isAlive' && !event.data.isAlive)) {
             this.completeTask();
        } else if (event.data.kind === 'isAlive') {
             // Successful health check is a single response task.
             this.completeTask();
        }
      }
    };

    this.worker.onerror = (event) => {
      this.handleError(event);
    };

    this.worker.onmessageerror = (event) => {
      this.handleError(event);
    }
  }

  private completeTask() {
    if (this.currentTask?.timeoutId) {
      clearTimeout(this.currentTask.timeoutId);
    }
    this.currentTask = null;
    this.isProcessing = false;
    // Trigger processing of the next item in the queue.
    setTimeout(() => this.processQueue(), 0);
  }

  private handleError(error: unknown) {
    if (this.currentTask) {
      if (this.currentTask.timeoutId) {
        clearTimeout(this.currentTask.timeoutId);
      }

      console.warn("Piper Worker Error:", error);

      if (this.currentTask.retriesLeft > 0) {
        console.log(`Retrying task... (${this.currentTask.retriesLeft} retries left)`);
        this.currentTask.retriesLeft--;
        this.restartWorker();
        this.runCurrentTask();
      } else {
        this.currentTask.onError(error);
        this.completeTask();
        // Always ensure a fresh worker state after a failure.
        this.restartWorker();
      }
    } else {
        // Error occurred without an active task (e.g., stray async error).
        // Restart worker to be safe.
        this.restartWorker();
    }
  }

  private restartWorker() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
