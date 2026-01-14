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

    it('throws error after max attempts', async () => {
        Object.defineProperty(window.navigator, 'serviceWorker', {
            value: {
                ready: Promise.resolve(),
                get controller() { return null; }, // Never appears
            },
            configurable: true,
            writable: true,
        });

        // Capture the promise and attach a catch handler IMMEDIATELY
        // to prevent "unhandled rejection" during timer advancement.
        const promise = waitForServiceWorkerController(window.navigator);
        const resultPromise = promise.catch(e => e);

        // Expontential backoff: ~1275ms
        // Advance enough time to exhaust retries
        await vi.advanceTimersByTimeAsync(2000);

        // Now check the result
        const result = await resultPromise;
        expect(result).toBeInstanceOf(Error);
        expect(result.message).toMatch(/Controller still not ready after 8 attempts/);
    });

    it('does nothing if serviceWorker is not supported', async () => {
        // Mock navigator with NO serviceWorker property
        // Note: JSDOM might have it, so we pass a custom object or partial navigator
        const mockNavigator = {} as Navigator;

        await expect(waitForServiceWorkerController(mockNavigator)).resolves.toBeUndefined();
    });
});
