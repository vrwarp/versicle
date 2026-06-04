import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForServiceWorkerController } from './serviceWorkerUtils';

describe('waitForServiceWorkerController', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
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
});
