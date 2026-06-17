import { WebPlugin } from '@capacitor/core';
export class MediaSessionWeb extends WebPlugin {
    async setMetadata(options) {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata(options);
        }
        else {
            throw this.unavailable('Media Session API not available in this browser.');
        }
    }
    async setPlaybackState(options) {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = options.playbackState;
        }
        else {
            throw this.unavailable('Media Session API not available in this browser.');
        }
    }
    ;
    async setActionHandler(options) {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler(options.action, (details) => {
                this.notifyListeners('onMediaAction', details);
            });
        }
        else {
            throw this.unavailable('Media Session API not available in this browser.');
        }
    }
    ;
    async setPositionState(options) {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setPositionState(options);
        }
        else {
            throw this.unavailable('Media Session API not available in this browser.');
        }
    }
    ;
    addListener(eventName, listenerFunc) {
        return super.addListener(eventName, listenerFunc);
    }
}
//# sourceMappingURL=web.js.map