import { type SpeechSegment } from './types';

interface PiperWorkerResponse {
  kind: 'output' | 'stderr' | 'fetch' | 'complete' | 'isAlive' | 'error';
  [key: string]: any;
}

interface RequestContext {
  id: string;
  data: any;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  onProgress?: (progress: number) => void;
  startTime: number;
  timeoutId?: any;
  retryCount: number;
}

export class PiperProcessSupervisor {
  private worker: Worker | null = null;
  private workerUrl: string;
  private activeRequest: RequestContext | null = null;
  private requestQueue: RequestContext[] = [];
  private isRestarting = false;
  private readonly REQUEST_TIMEOUT_MS = 30000; // 30s timeout
  private readonly MAX_RETRIES = 1;
  private blobCache: Record<string, Blob> = {};

  constructor(workerUrl: string) {
    this.workerUrl = workerUrl;
    this.startWorker();
  }

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
        this.requestQueue.push(context);
      } else {
        this.processRequest(context);
      }
    });
  }

  private processRequest(context: RequestContext) {
    this.activeRequest = context;
    if (!this.worker) {
        this.startWorker();
    }

    // Set timeout
    const timeoutId = setTimeout(() => {
      if (this.activeRequest === context) {
        console.error('[PiperSupervisor] Request timed out');
        this.handleWorkerError(new Error('Request timed out'));
      }
    }, this.REQUEST_TIMEOUT_MS);

    // Attach timeout ID to context
    context.timeoutId = timeoutId;

    // Inject blobCache into the data payload
    const payload = { ...context.data, blobs: this.blobCache };

    this.worker!.postMessage(payload);
  }

  private handleMessage(event: MessageEvent) {
    const data = event.data as PiperWorkerResponse;
    const context = this.activeRequest;

    if (!context) {
        // Might be a stray message from previous run or unprompted
        return;
    }

    switch (data.kind) {
      case 'fetch':
        if (data.blob && data.url) {
            this.blobCache[data.url] = data.blob;
        }
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
        clearTimeout(context.timeoutId);
        this.activeRequest = null;
        context.resolve(data);
        this.processNext();
        break;

      case 'isAlive':
        clearTimeout(context.timeoutId);
        this.activeRequest = null;
        context.resolve(data.isAlive);
        this.processNext();
        break;

      case 'stderr':
        console.error('[PiperWorker]', data.message);
        break;

      case 'error':
        console.error('[PiperWorker Error]', data);
        clearTimeout(context.timeoutId);
        this.handleWorkerError(new Error(data.message || 'Worker reported error'));
        break;

      case 'complete':
        // usually comes after output.
        break;
    }
  }

  private async handleWorkerError(error: Error) {
    console.warn('[PiperSupervisor] Handling worker error:', error);

    // 1. Capture current request
    const failedRequest = this.activeRequest;
    this.activeRequest = null;

    // 2. Terminate and restart
    this.isRestarting = true;
    this.startWorker();
    this.isRestarting = false;

    // 3. Retry logic
    if (failedRequest) {
        clearTimeout(failedRequest.timeoutId);

        if (failedRequest.retryCount < this.MAX_RETRIES) {
            console.log(`[PiperSupervisor] Retrying request ${failedRequest.id}...`);
            failedRequest.retryCount++;
            this.requestQueue.unshift(failedRequest);
        } else {
            console.error(`[PiperSupervisor] Request ${failedRequest.id} failed after retries.`);
            failedRequest.reject(error);
        }
    }

    this.processNext();
  }

  private processNext() {
    if (this.requestQueue.length > 0 && !this.activeRequest && !this.isRestarting) {
      const next = this.requestQueue.shift();
      if (next) this.processRequest(next);
    }
  }

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

  public deleteCachedModel(modelUrl: string, modelConfigUrl: string) {
      if (this.blobCache[modelUrl]) delete this.blobCache[modelUrl];
      if (this.blobCache[modelConfigUrl]) delete this.blobCache[modelConfigUrl];
      // We also restart the worker to clear its memory
      this.startWorker();
  }
}
