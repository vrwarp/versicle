import silenceUrl from '../../assets/silence.ogg';
import whiteNoiseUrl from '../../assets/white-noise.ogg';

export type BackgroundAudioMode = 'silence' | 'noise' | 'off';

export class BackgroundAudio {
    private audio: HTMLAudioElement;
    private stopTimeout: ReturnType<typeof setTimeout> | null = null;
    private currentMode: BackgroundAudioMode = 'off';
    private whiteNoiseVolume: number = 0.1;

    constructor() {
        this.audio = new Audio();
        this.audio.loop = true;
    }

    setVolume(volume: number) {
        this.whiteNoiseVolume = Math.max(0, Math.min(1, volume));
        if (this.currentMode === 'noise') {
            this.audio.volume = this.whiteNoiseVolume;
        }
    }

    play(mode: BackgroundAudioMode) {
        this.cancelDebounce();

        if (mode === 'off') {
            this.forceStop();
            return;
        }

        const targetSrc = mode === 'noise' ? whiteNoiseUrl : silenceUrl;
        const targetVolume = mode === 'noise' ? this.whiteNoiseVolume : 1.0;

        // If switching source, or if just starting
        if (this.audio.getAttribute('src') !== targetSrc) {
            this.audio.src = targetSrc;
            // When src changes, we might want to load(), though play() usually handles it.
            // load() resets currentTime to 0.
        }

        this.audio.volume = targetVolume;
        this.currentMode = mode;

        if (this.audio.paused) {
            this.audio.play().catch(e => {
                 console.warn("BackgroundAudio play failed", e);
            });
        }
    }

    stopWithDebounce(delayMs: number) {
        this.cancelDebounce();
        this.stopTimeout = setTimeout(() => {
            this.audio.pause();
            this.stopTimeout = null;
        }, delayMs);
    }

    cancelDebounce() {
        if (this.stopTimeout) {
            clearTimeout(this.stopTimeout);
            this.stopTimeout = null;
        }
    }

    forceStop() {
        this.cancelDebounce();
        this.audio.pause();
        this.audio.currentTime = 0;
        this.currentMode = 'off';
    }
}
