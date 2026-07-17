/**
 * Registration-failure signal for the boot gate. `navigator.serviceWorker.ready`
 * NEVER settles when registration fails (it waits for an active registration
 * that will never exist), so without this signal a failed registration costs
 * every boot the full timeout below — a 3s blank screen for exactly the users
 * whose service worker is broken. The registration owner (SWUpdatePrompt's
 * `onRegisterError`) reports failure here; the gate resolves immediately.
 */
let registrationFailed = false;
let notifyRegistrationFailed: () => void = () => {};
let registrationFailedPromise = createRegistrationFailedPromise();

function createRegistrationFailedPromise(): Promise<'failed'> {
    return new Promise<'failed'>((resolve) => {
        notifyRegistrationFailed = () => {
            registrationFailed = true;
            resolve('failed');
        };
    });
}

export function signalServiceWorkerRegistrationFailed(): void {
    notifyRegistrationFailed();
}

/** Test-only: re-arm the module-level registration-failure signal. */
export function resetServiceWorkerRegistrationSignalForTests(): void {
    registrationFailed = false;
    registrationFailedPromise = createRegistrationFailedPromise();
}

export async function waitForServiceWorkerController(
    navigatorArg: Navigator = navigator,
    maxAttempts = 8,
    initialDelay = 5
): Promise<void> {
    if (!('serviceWorker' in navigatorArg)) {
        return;
    }
    if (registrationFailed) {
        return;
    }

    // Race against a timeout so the app doesn't hang if the SW is blocked
    // (e.g., in WebKit/Playwright test environments with serviceWorkers:'block'),
    // and against the registration-failure signal so a failed registration
    // releases the boot gate immediately instead of after the full timeout.
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 3000));
    const result = await Promise.race([
        navigatorArg.serviceWorker.ready.then(() => 'ready' as const),
        registrationFailedPromise,
        timeout,
    ]);
    if (result !== 'ready') {
        return;
    }

    let attempt = 0;
    let delay = initialDelay;

    while (!navigatorArg.serviceWorker.controller) {
        if (attempt >= maxAttempts) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
        attempt++;
    }
}
