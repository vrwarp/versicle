/**
 * Represents the structured response from the Piper worker.
 */
interface PiperWorkerResponse {
  /** The type of message received from the worker. */
  kind: 'output' | 'stderr' | 'fetch' | 'complete' | 'isAlive' | 'error';
  /** Additional data fields depending on the message kind. */
  [key: string]: any;
}

/**
 * Tracks the state and context of a single synthesis request.
 */
interface RequestContext {
  /** Unique identifier for the request. */
  id: string;
  /** The payload to send to the worker. */
  data: any;
  /** Promise resolver for the request. */
  resolve: (value: any) => void;
  /** Promise rejecter for the request. */
  reject: (reason: any) => void;
  /** Optional callback for progress updates. */
  onProgress?: (progress: number) => void;
  /** Timestamp when the request was created. */
  startTime: number;
  /** ID of the timeout timer, used to cancel timeout on success. */
  timeoutId?: any;
  /** Number of times this request has been retried. */
  retryCount: number;
}

/**
 * Supervises the lifecycle of the Piper TTS Web Worker.
 *
 * This class ensures robustness by:
 * 1.  **Timeouts:** Enforcing a maximum duration for requests (30s) to detect hangs.
 * 2.  **Retries:** Automatically retrying failed requests once to handle transient errors.
 * 3.  **Queueing:** Buffering requests when the worker is restarting or busy.
 * 4.  **Blob Caching:** Persisting downloaded voice models (blobs) in the main thread so they survive worker restarts.
 */
export class PiperProcessSupervisor {
  /** The active Web Worker instance. Null if not started or terminated. */
  private worker: Worker | null = null;
  /** The URL of the worker script. */
  private workerUrl: string;
  /** The currently executing request, or null if idle. */
  private activeRequest: RequestContext | null = null;
  /** Queue of pending requests waiting for the worker. */
  private requestQueue: RequestContext[] = [];
  /** Flag indicating if the worker is currently restarting (to prevent concurrent starts). */
  private isRestarting = false;
  /** Maximum time allowed for a request before it is considered timed out. */
  private readonly REQUEST_TIMEOUT_MS = 30000; // 30s timeout
  /** Maximum number of retries allowed for a failed request. */
  private readonly MAX_RETRIES = 1;
  /** Cache of downloaded blobs (models, configs) to persist across worker restarts. */
  private blobCache: Record<string, Blob> = {};

  /**
   * Creates a new Supervisor instance.
   * @param workerUrl - The URL of the Piper worker script.
   */
  constructor(workerUrl: string) {
    this.workerUrl = workerUrl;
    this.startWorker();
  }

  /**
   * Initializes or re-initializes the Web Worker.
   * Terminates any existing worker first.
   */
  private startWorker() {
    if (this.worker) {
      this.worker.terminate();
    }
    console.log('[PiperSupervisor] Starting worker...');
    this.worker = new Worker(this.workerUrl);
    this.worker.addEventListener('message', this.handleMessage.bind(this));
    this.worker.addEventListener('error', (err) => {
        console.error('[PiperSupervisor] Worker error event:', err);
        this.handleWorkerError(new Error(err.message || 'Worker error event'));
    });
  }

  /**
   * Submits a request to the Piper worker.
   *
   * @param data - The message payload to send.
   * @param onProgress - Optional callback for progress updates (0-100).
   * @returns A promise that resolves with the worker's response or rejects on error.
   */
  public async request(data: any, onProgress?: (progress: number) => void): Promise<any> {
    return new Promise((resolve, reject) => {
      const context: RequestContext = {
        id: crypto.randomUUID(),
        data,
        resolve,
        reject,
        onProgress,
        startTime: Date.now(),
        retryCount: 0
      };

      if (this.isRestarting || this.activeRequest) {
        // Queue the request if the worker is busy or restarting.
        this.requestQueue.push(context);
      } else {
        this.processRequest(context);
      }
    });
  }

  /**
   * Sends a request to the worker and sets up the timeout.
   * @param context - The request context to process.
   */
  private processRequest(context: RequestContext) {
    this.activeRequest = context;
    if (!this.worker) {
        this.startWorker();
    }

    // Set timeout to detect hangs (e.g., WASM crash without error event)
    const timeoutId = setTimeout(() => {
      if (this.activeRequest === context) {
        console.error('[PiperSupervisor] Request timed out');
        this.handleWorkerError(new Error('Request timed out'));
      }
    }, this.REQUEST_TIMEOUT_MS);

    // Attach timeout ID to context so we can clear it on success
    context.timeoutId = timeoutId;

    // Inject blobCache into the data payload so the new worker instance has access to previously downloaded files.
    // This allows seamless restarts without re-downloading large models.
    const payload = { ...context.data, blobs: this.blobCache };

    this.worker!.postMessage(payload);
  }

  /**
   * Handles messages received from the worker.
   * @param event - The message event.
   */
  private handleMessage(event: MessageEvent) {
    const data = event.data as PiperWorkerResponse;
    const context = this.activeRequest;

    if (!context) {
        // Ignore messages if no request is active (e.g. from a previous timed-out request)
        return;
    }

    switch (data.kind) {
      case 'fetch':
        // Update local blob cache with fetched data
        if (data.blob && data.url) {
            this.blobCache[data.url] = data.blob;
        }
        // Report progress
        if (context.onProgress) {
           const progress = data.blob
            ? 1
            : data.total
            ? data.loaded / data.total
            : 0;
           context.onProgress(Math.round(progress * 100));
        }
        break;

      case 'output':
        // Successful synthesis
        clearTimeout(context.timeoutId);
        this.activeRequest = null;
        context.resolve(data);
        this.processNext();
        break;

      case 'isAlive':
        // Health check response
        clearTimeout(context.timeoutId);
        this.activeRequest = null;
        context.resolve(data.isAlive);
        this.processNext();
        break;

      case 'stderr':
        // Log warnings/errors from the worker (WASM stdout/stderr)
        console.error('[PiperWorker]', data.message);
        break;

      case 'error':
        // Explicit error reported by the worker
        console.error('[PiperWorker Error]', data);
        clearTimeout(context.timeoutId);
        this.handleWorkerError(new Error(data.message || 'Worker reported error'));
        break;

      case 'complete':
        // Usually comes after output, safe to ignore if output resolved.
        break;
    }
  }

  /**
   * Handles worker errors (timeouts, crashes, explicit errors).
   * Restarts the worker and attempts to retry the failed request.
   * @param error - The error encountered.
   */
  private async handleWorkerError(error: Error) {
    console.warn('[PiperSupervisor] Handling worker error:', error);

    // 1. Capture current request to potentially retry
    const failedRequest = this.activeRequest;
    this.activeRequest = null;

    // 2. Terminate and restart the worker to clear bad state
    this.isRestarting = true;
    this.startWorker();
    this.isRestarting = false;

    // 3. Retry logic
    if (failedRequest) {
        clearTimeout(failedRequest.timeoutId);

        // Retry if under limit
        if (failedRequest.retryCount < this.MAX_RETRIES) {
            console.log(`[PiperSupervisor] Retrying request ${failedRequest.id}...`);
            failedRequest.retryCount++;
            // Prepend to queue to be processed immediately after restart
            this.requestQueue.unshift(failedRequest);
        } else {
            console.error(`[PiperSupervisor] Request ${failedRequest.id} failed after retries.`);
            failedRequest.reject(error);
        }
    }

    // Process the next request (which might be the retried one)
    this.processNext();
  }

  /**
   * Processes the next request in the queue, if any.
   */
  private processNext() {
    if (this.requestQueue.length > 0 && !this.activeRequest && !this.isRestarting) {
      const next = this.requestQueue.shift();
      if (next) this.processRequest(next);
    }
  }

  /**
   * Manually terminates the supervisor and rejects all pending requests.
   */
  public terminate() {
      if (this.worker) {
          this.worker.terminate();
          this.worker = null;
      }
      if (this.activeRequest) {
          this.activeRequest.reject(new Error('Supervisor terminated'));
          this.activeRequest = null;
      }
      this.requestQueue.forEach(req => req.reject(new Error('Supervisor terminated')));
      this.requestQueue = [];
      this.blobCache = {};
  }

  /**
   * Deletes a model from the blob cache and restarts the worker.
   * @param modelUrl - The URL of the model to delete.
   * @param modelConfigUrl - The URL of the model config to delete.
   */
  public deleteCachedModel(modelUrl: string, modelConfigUrl: string) {
      if (this.blobCache[modelUrl]) delete this.blobCache[modelUrl];
      if (this.blobCache[modelConfigUrl]) delete this.blobCache[modelConfigUrl];
      // Restart the worker to clear its memory of the model
      this.startWorker();
  }
}
