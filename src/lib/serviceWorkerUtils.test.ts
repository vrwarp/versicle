import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    waitForServiceWorkerController,
    signalServiceWorkerRegistrationFailed,
    resetServiceWorkerRegistrationSignalForTests,
} from './serviceWorkerUtils';

describe('waitForServiceWorkerController', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetServiceWorkerRegistrationSignalForTests();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        resetServiceWorkerRegistrationSignalForTests();
    });

    it('resolves immediately if controller is already present', async () => {
        Object.defineProperty(window.navigator, 'serviceWorker', {
            value: {
                ready: Promise.resolve(),
                controller: {}, // Present
            },
            configurable: true,
            writable: true,
        });

        const promise = waitForServiceWorkerController(window.navigator);
        await expect(promise).resolves.toBeUndefined();
    });

    it('waits for ready then polls for controller', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let controllerValue: any = null;
        const readyPromise = Promise.resolve();

        Object.defineProperty(window.navigator, 'serviceWorker', {
            value: {
                ready: readyPromise,
                get controller() { return controllerValue; },
            },
            configurable: true,
            writable: true,
        });

        const promise = waitForServiceWorkerController(window.navigator);

        // Should not resolve yet
        // Advance time a bit
        await vi.advanceTimersByTimeAsync(100);

        // Make controller appear
        controllerValue = {};

        // Advance time to catch next poll
        await vi.advanceTimersByTimeAsync(100);

        await expect(promise).resolves.toBeUndefined();
    });

    it('resolves gracefully after max attempts (does not hang or throw)', async () => {
        Object.defineProperty(window.navigator, 'serviceWorker', {
            value: {
                ready: Promise.resolve(),
                get controller() { return null; }, // Never appears
            },
            configurable: true,
            writable: true,
        });

        const promise = waitForServiceWorkerController(window.navigator);

        // Exponential backoff over 8 attempts (~1275ms). Advance enough to exhaust them.
        await vi.advanceTimersByTimeAsync(2000);

        // The function gives up gracefully (resolves) rather than throwing, so callers
        // can proceed even when the SW never takes control (e.g. WebKit / Playwright with
        // serviceWorkers:'block'). See waitForServiceWorkerController.
        await expect(promise).resolves.toBeUndefined();
    });

    it('does nothing if serviceWorker is not supported', async () => {
        // Mock navigator with NO serviceWorker property
        // Note: JSDOM might have it, so we pass a custom object or partial navigator
        const mockNavigator = {} as Navigator;

        await expect(waitForServiceWorkerController(mockNavigator)).resolves.toBeUndefined();
    });

    it('resolves immediately when registration failure is signaled mid-wait (ready never settles)', async () => {
        Object.defineProperty(window.navigator, 'serviceWorker', {
            value: {
                ready: new Promise(() => {}), // failed registration: never settles
                controller: null,
            },
            configurable: true,
            writable: true,
        });

        const resolved = vi.fn();
        const promise = waitForServiceWorkerController(window.navigator).then(resolved);

        // Still waiting (would previously wait the full 3s timeout).
        await vi.advanceTimersByTimeAsync(50);
        expect(resolved).not.toHaveBeenCalled();

        signalServiceWorkerRegistrationFailed();
        await vi.advanceTimersByTimeAsync(0);

        await expect(promise).resolves.toBeUndefined();
        expect(resolved).toHaveBeenCalled();
    });

    it('resolves immediately when registration already failed before the wait started', async () => {
        Object.defineProperty(window.navigator, 'serviceWorker', {
            value: {
                ready: new Promise(() => {}),
                controller: null,
            },
            configurable: true,
            writable: true,
        });

        signalServiceWorkerRegistrationFailed();

        await expect(waitForServiceWorkerController(window.navigator)).resolves.toBeUndefined();
    });
});
