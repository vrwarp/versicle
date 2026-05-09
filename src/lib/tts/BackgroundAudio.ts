import silenceUrl from '../../assets/silence.ogg';
import whiteNoiseUrl from '../../assets/10s_8k_sub_bass_vbr_off.webm';

export type BackgroundAudioMode = 'silence' | 'noise' | 'off';

export class BackgroundAudio {
    private audio1: HTMLAudioElement;
    private audio2: HTMLAudioElement;
    private stopTimeout: ReturnType<typeof setTimeout> | null = null;
    private secondaryTimeout: ReturnType<typeof setTimeout> | null = null;
    private currentMode: BackgroundAudioMode = 'off';
    private linearVolume: number = 0.1;

    private getPerceptualVolume(linearVal: number): number {
        return Math.pow(linearVal, 3);
    }

    constructor() {
        this.audio1 = new Audio();
        this.audio1.loop = true;
        this.audio2 = new Audio();
        this.audio2.loop = true;
    }

    setVolume(volume: number) {
        this.linearVolume = Math.max(0, Math.min(1, volume));
        const targetVolume = this.currentMode === 'noise' ? this.getPerceptualVolume(this.linearVolume) : 1.0;
        this.audio1.volume = targetVolume;
        this.audio2.volume = targetVolume;
    }

    play(mode: BackgroundAudioMode) {
        this.cancelDebounce();

        if (mode === 'off') {
            this.forceStop();
            return;
        }

        const targetSrc = mode === 'noise' ? whiteNoiseUrl : silenceUrl;
        const targetVolume = mode === 'noise' ? this.getPerceptualVolume(this.linearVolume) : 1.0;

        if (this.currentMode !== mode || this.audio1.error || !this.audio1.src) {
            this.audio1.src = targetSrc;
            this.audio2.src = targetSrc;
        }

        this.audio1.volume = targetVolume;
        this.audio2.volume = targetVolume;

        this.currentMode = mode;

        if (this.audio1.paused) {
            this.audio1.play().catch(e => {
                 console.warn("BackgroundAudio audio1 play failed", e);
            });

            if (this.secondaryTimeout) clearTimeout(this.secondaryTimeout);
            this.secondaryTimeout = setTimeout(() => {
                this.audio2.play().catch(e => {
                    console.warn("BackgroundAudio audio2 play failed", e);
                });
                this.secondaryTimeout = null;
            }, 5000);
        }
    }

    stopWithDebounce(delayMs: number) {
        this.cancelDebounce();
        this.stopTimeout = setTimeout(() => {
            this.audio1.pause();
            this.audio2.pause();
            this.stopTimeout = null;
        }, delayMs);
    }

    cancelDebounce() {
        if (this.stopTimeout) {
            clearTimeout(this.stopTimeout);
            this.stopTimeout = null;
        }
        if (this.secondaryTimeout) {
            clearTimeout(this.secondaryTimeout);
            this.secondaryTimeout = null;
        }
    }

    forceStop() {
        this.cancelDebounce();
        this.audio1.pause();
        this.audio1.currentTime = 0;
        this.audio2.pause();
        this.audio2.currentTime = 0;
        this.currentMode = 'off';
    }
}
