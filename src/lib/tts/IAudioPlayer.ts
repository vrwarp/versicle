export interface IAudioPlayer {
    playBlob(blob: Blob): Promise<void>;
    pause(): void;
    resume(): void;
    stop(): void;
    setRate(rate: number): void;
    getDuration(): number;
    setOnTimeUpdate(callback: (time: number) => void): void;
    setOnEnded(callback: () => void): void;
    setOnError(callback: (error: string) => void): void;
}
