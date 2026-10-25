/**
 * Device-local switch for the experimental Web Audio keepalive (Android).
 *
 * Stored in localStorage on purpose: it is a per-device diagnostic for checking
 * whether a Web Audio stream keeps background reading alive (see
 * WebAudioKeepalive), not a synced setting. Every access is guarded because
 * storage can be unavailable (private mode, cleared site data, tests).
 */
const KEY = 'versicle.tts.webAudioKeepalive';

export function isWebAudioKeepaliveEnabled(): boolean {
    try {
        return globalThis.localStorage?.getItem(KEY) === '1';
    } catch {
        return false;
    }
}

export function setWebAudioKeepaliveEnabled(enabled: boolean): void {
    try {
        if (enabled) {
            globalThis.localStorage?.setItem(KEY, '1');
        } else {
            globalThis.localStorage?.removeItem(KEY);
        }
    } catch {
        // Storage unavailable: the toggle simply does not persist.
    }
}
