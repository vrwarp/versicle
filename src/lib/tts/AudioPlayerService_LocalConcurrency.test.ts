import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlayerService, TTSQueueItem } from './AudioPlayerService';
import { ITTSProvider, SpeechSegment, TTSVoice } from './providers/types';

// Mock Dependencies
vi.mock('../../db/DBService', () => ({
  dbService: {
    getBookMetadata: vi.fn().mockResolvedValue({}),
    updatePlaybackState: vi.fn().mockResolvedValue(undefined),
    saveTTSState: vi.fn(),
    getTTSState: vi.fn().mockResolvedValue(null),
  }
}));

vi.mock('./LexiconService', () => ({
    LexiconService: {
        getInstance: vi.fn().mockReturnValue({
            getRules: vi.fn().mockResolvedValue([]),
            applyLexicon: vi.fn((text) => text),
            getRulesHash: vi.fn().mockResolvedValue('hash'),
        })
    }
}));

vi.mock('./TTSCache', () => {
  return {
    TTSCache: class {
      generateKey = vi.fn().mockResolvedValue('key');
      get = vi.fn().mockResolvedValue(null);
      put = vi.fn().mockResolvedValue(undefined);
    }
  };
});

// Mock MediaSessionManager
vi.mock('./MediaSessionManager', () => {
  return {
    MediaSessionManager: class {
        constructor() {}
        setMetadata = vi.fn().mockResolvedValue(undefined);
        setPlaybackState = vi.fn().mockResolvedValue(undefined);
        setPositionState = vi.fn().mockResolvedValue(undefined);
    }
  }
});

class BlockingLocalProvider implements ITTSProvider {
    id = 'local';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private callback: ((event: any) => void) | null = null;
    private stopResolve: (() => void) | null = null;
    public stopCalled = false;

    async init() {}
    async getVoices(): Promise<TTSVoice[]> { return []; }

    async synthesize(text: string, voiceId: string, speed: number, signal?: AbortSignal): Promise<SpeechSegment> {
        this.stopCalled = false;
        // Native blocking behavior:
        // Returns a promise that resolves only when speech is done.
        // It does NOT respect signal.aborted directly (except at start).

        if (signal?.aborted) throw new Error('Aborted');

        this.emit('start');

        await new Promise<void>(resolve => {
            this.stopResolve = resolve;
            // Simulate 500ms speech duration
            setTimeout(() => {
                if (this.stopResolve) {
                    this.stopResolve();
                    this.stopResolve = null;
                }
            }, 500);
        });

        this.emit('end');
        return { isNative: true };
    }

    async stop() {
        this.stopCalled = true;
        if (this.stopResolve) {
            this.stopResolve();
            this.stopResolve = null;
        }
    }

    async pause() {
        await this.stop();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(callback: (event: any) => void) {
        this.callback = callback;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private emit(type: string, data: any = {}) {
        if (this.callback) this.callback({ type, ...data });
    }
}

describe('AudioPlayerService Local Concurrency', () => {
  let service: AudioPlayerService;
  let provider: BlockingLocalProvider;

  const queue: TTSQueueItem[] = [
      { text: 'One', cfi: '1' },
      { text: 'Two', cfi: '2' },
  ];

  beforeEach(async () => {
    // Reset singleton
    // @ts-expect-error Resetting singleton
    AudioPlayerService.instance = undefined;
    service = AudioPlayerService.getInstance();
    provider = new BlockingLocalProvider();

    await service.setProvider(provider);
    await service.setQueue(queue);
    await service.init();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call stop() on the provider when seeking/aborting', async () => {
    // 1. Play first item
    const playPromise = service.play();

    // Wait a bit for it to start
    await new Promise(resolve => setTimeout(resolve, 50));

    // 2. Seek to next item (this aborts the first play)
    // seek calls executeWithLock, which aborts current op.
    const seekPromise = service.next();

    // The first playPromise should finish (either naturally or stopped)
    // seekPromise should finish
    await Promise.all([playPromise, seekPromise]);

    // Check if stop() was called on the provider.
    // If NOT called, it means we relied on natural completion (500ms delay),
    // which is bad for UX (unresponsive buttons).
    // If called, it means we properly interrupted the native speech.

    expect(provider.stopCalled).toBe(true);
  });
});
