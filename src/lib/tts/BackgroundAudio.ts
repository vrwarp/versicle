import silenceUrl from '../../assets/silence.ogg';
import whiteNoiseUrl from '../../assets/white-noise.ogg';

export interface BackgroundAudioConfig {
    silentAudioType: 'silence' | 'white-noise';
    whiteNoiseVolume: number;
}

export class BackgroundAudio {
    private silentAudio: HTMLAudioElement;
    private config: BackgroundAudioConfig;

    constructor(config: BackgroundAudioConfig = { silentAudioType: 'silence', whiteNoiseVolume: 0.1 }) {
        this.config = config;
        this.silentAudio = new Audio();
        this.silentAudio.loop = true;
        this.updateSilentAudio();
    }

    setConfig(config: BackgroundAudioConfig) {
        this.config = config;
        this.updateSilentAudio();
    }

    private updateSilentAudio() {
        const src = this.config.silentAudioType === 'white-noise' ? whiteNoiseUrl : silenceUrl;
        const currentSrc = this.silentAudio.getAttribute('src');
        if (currentSrc !== src) {
            const wasPlaying = !this.silentAudio.paused;
            if (wasPlaying) this.silentAudio.pause();
            this.silentAudio.src = src;
            if (wasPlaying) {
                this.silentAudio.play().catch(e => console.warn("Background audio switch failed", e));
            }
        }
        if (this.config.silentAudioType === 'white-noise') {
            this.silentAudio.volume = Math.min(Math.max(this.config.whiteNoiseVolume, 0), 1);
        } else {
            this.silentAudio.volume = 1.0;
        }
    }

    play() {
        if (this.silentAudio.paused) {
            this.silentAudio.play().catch(e => console.warn("Background audio play failed", e));
        }
    }

    pause() {
        this.silentAudio.pause();
    }

    stop() {
        this.silentAudio.pause();
        this.silentAudio.currentTime = 0;
    }
}
