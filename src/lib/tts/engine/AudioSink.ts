/**
 * AudioSink — the audio-output device abstraction.
 *
 * This is the second half of the engine boundary (the first being {@link EngineContext}
 * for host state). Where `EngineContext` abstracts main-thread *state*, `AudioSink`
 * abstracts the main-thread *audio hardware*: `HTMLAudioElement`, `AudioContext`, and the
 * Web Audio earcon graph. None of those exist in a Web Worker, so playback of synthesized
 * audio must always happen behind this port.
 *
 * The production implementation is {@link AudioElementPlayer} (HTML5 `<audio>` + Web Audio
 * ducking). Tests use `FakeAudioSink`, which records calls and lets the test fire the
 * lifecycle callbacks deterministically — no jsdom media-element shims required. In the
 * worker topology, the sink lives on the main thread and the engine (in the worker) drives
 * it across the message channel.
 */
export interface AudioSink {
    /** Play an audio blob. Resolves when playback *starts*. */
    playBlob(blob: Blob): Promise<void>;
    /** Play audio from a URL. Resolves when playback *starts*. */
    playUrl(url: string): Promise<void>;
    pause(): void;
    resume(): Promise<void>;
    /** Stop playback, reset to the start, and release the current source. */
    stop(): void;
    setVolume(volume: number): void;
    setRate(rate: number): void;
    seek(time: number): void;
    getCurrentTime(): number;
    getDuration(): number;
    setOnTimeUpdate(callback: (time: number) => void): void;
    setOnEnded(callback: () => void): void;
    setOnError(callback: (error: MediaError | null) => void): void;
    /** Play a short UI earcon, ducking the main audio if it's playing. */
    playEarcon(type: 'bookmark_captured' | 'bookmark_failed'): void;
    /** Tear down listeners and release the underlying audio resources. */
    destroy(): void;
}
