import { Capacitor } from '@capacitor/core';
import { BackgroundAudio, type BackgroundAudioMode } from './BackgroundAudio';
import { WebAudioKeepalive } from './WebAudioKeepalive';
import { isWebAudioKeepaliveEnabled } from './keepaliveFlags';

interface KeepaliveBackend {
    play(mode: BackgroundAudioMode): void;
    stopWithDebounce(delayMs: number): void;
    cancelDebounce(): void;
    forceStop(): void;
    setVolume(volume: number): void;
}

/**
 * Picks the background-reading keepalive on every start: the existing
 * HTMLAudioElement keepalive (BackgroundAudio, unchanged) by default, or the
 * experimental WebAudioKeepalive on Android when the device-local diagnostic
 * switch is on. Checking at each play() means flipping the switch takes effect
 * on the next start without an app restart.
 */
export class KeepaliveSelector implements KeepaliveBackend {
    private readonly element: BackgroundAudio;
    private webAudio: WebAudioKeepalive | null = null;
    private active: KeepaliveBackend;
    private volume = 0.1;

    constructor(
        element: BackgroundAudio = new BackgroundAudio(),
        private readonly useWebAudio: () => boolean = () =>
            isWebAudioKeepaliveEnabled() && Capacitor.getPlatform() === 'android',
        private readonly makeWebAudio: () => WebAudioKeepalive = () => new WebAudioKeepalive(),
    ) {
        this.element = element;
        this.active = element;
    }

    play(mode: BackgroundAudioMode) {
        const wantWebAudio = mode !== 'off' && this.useWebAudio();
        if (wantWebAudio && !(this.active instanceof WebAudioKeepalive)) {
            this.element.forceStop();
            this.webAudio ??= this.makeWebAudio();
            this.webAudio.setVolume(this.volume);
            this.active = this.webAudio;
        } else if (!wantWebAudio && this.active !== this.element) {
            this.webAudio?.dispose();
            this.active = this.element;
        }
        this.active.play(mode);
    }

    stopWithDebounce(delayMs: number) {
        this.active.stopWithDebounce(delayMs);
    }

    cancelDebounce() {
        this.active.cancelDebounce();
    }

    forceStop() {
        this.active.forceStop();
    }

    setVolume(volume: number) {
        this.volume = volume;
        this.element.setVolume(volume);
        this.webAudio?.setVolume(volume);
    }

    /** Which backend is active (diagnostics/tests). */
    get kind(): 'element' | 'webaudio' {
        return this.active === this.element ? 'element' : 'webaudio';
    }
}
