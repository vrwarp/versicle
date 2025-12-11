import { AudioPlayerService } from './tts/AudioPlayerService';
import { useTTSStore } from '../store/useTTSStore';
import { Capacitor } from '@capacitor/core';

export interface DebugSnapshot {
    timestamp: string;
    userAgent: string;
    platform: string;
    queue: {
        length: number;
        currentIndex: number;
        currentCfi: string | null;
        items: {
            textLength: number;
            cfi: string | null;
        }[];
    };
    settings: {
        providerId: string;
        silentAudioType: string;
        whiteNoiseVolume: number;
    };
    logs: string[];
}

class DebugService {
    private static instance: DebugService;
    private logBuffer: string[] = [];
    private readonly MAX_LOGS = 50;

    private constructor() {
        this.overrideConsole();
    }

    static getInstance(): DebugService {
        if (!DebugService.instance) {
            DebugService.instance = new DebugService();
        }
        return DebugService.instance;
    }

    private overrideConsole() {
        const originalLog = console.log;
        const originalWarn = console.warn;
        const originalError = console.error;

        console.log = (...args) => {
            this.captureLog('INFO', args);
            originalLog.apply(console, args);
        };

        console.warn = (...args) => {
            this.captureLog('WARN', args);
            originalWarn.apply(console, args);
        };

        console.error = (...args) => {
            this.captureLog('ERROR', args);
            originalError.apply(console, args);
        };
    }

    private captureLog(level: string, args: unknown[]) {
        const message = args.map(arg => {
            if (arg instanceof Error) return arg.message + '\n' + arg.stack;
            if (typeof arg === 'object') return JSON.stringify(arg);
            return String(arg);
        }).join(' ');

        const timestamp = new Date().toISOString();
        this.logBuffer.push(`[${timestamp}] [${level}] ${message}`);
        if (this.logBuffer.length > this.MAX_LOGS) {
            this.logBuffer.shift();
        }
    }

    async createSnapshot(): Promise<DebugSnapshot> {
        const audioPlayer = AudioPlayerService.getInstance();
        const queue = audioPlayer.getQueue();
        const ttsStore = useTTSStore.getState();

        // Safe extraction of queue items (anonymized/minimized)
        const queueItems = queue.slice(Math.max(0, queue.length - 10), Math.min(queue.length, queue.length + 10)).map(item => ({
            textLength: item.text.length,
            cfi: item.cfi
        }));

        // Get index safely (AudioPlayerService doesn't expose public index directly via getter,
        // but we can infer it via getQueue() if we hacked it, or just rely on what we can get.
        // Actually AudioPlayerService doesn't expose currentIndex publicly via getter.
        // But we can subscribe to it.
        // For now let's just use what we can get or modify AudioPlayerService if needed.
        // I will assume for now we can get the queue. currentIndex is missing.
        // Let's modify AudioPlayerService to expose currentIndex via getter or a debug method.
        // Wait, AudioPlayerService has `getQueue`. It does not have `getCurrentIndex`.
        // I'll add `getCurrentIndex` to AudioPlayerService.

        // Wait, I am in DebugService. I can't easily sync modify AudioPlayerService right now without context switching.
        // Let's assume I will add `getCurrentIndex` to AudioPlayerService in the next step or right now.
        // Actually I can access it if I cast to any, but that's ugly.
        // Better: AudioPlayerService.getInstance()

        // Let's check AudioPlayerService again.
        // It has `subscribe`.

        // Use a temporary listener to get current state? No that's async.

        // I'll use `(audioPlayer as any).currentIndex` for now to avoid modifying the service just for this
        // if I want to be strict, but modifying the service is better.
        // Let's assume I will add `getCurrentIndex()` to AudioPlayerService.

        const currentIndex = audioPlayer.getCurrentIndex();

        return {
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            platform: Capacitor.getPlatform(),
            queue: {
                length: queue.length,
                currentIndex: currentIndex,
                currentCfi: queue[currentIndex]?.cfi || null,
                items: queueItems
            },
            settings: {
                providerId: ttsStore.providerId,
                silentAudioType: ttsStore.silentAudioType,
                whiteNoiseVolume: ttsStore.whiteNoiseVolume
            },
            logs: [...this.logBuffer]
        };
    }

    async exportSnapshot() {
        const snapshot = await this.createSnapshot();
        const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `versicle-debug-${new Date().getTime()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

export const debugService = DebugService.getInstance();
