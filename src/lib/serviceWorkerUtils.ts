export async function waitForServiceWorkerController(
    navigatorArg: Navigator = navigator,
    maxAttempts = 8,
    initialDelay = 5
): Promise<void> {
    if (!('serviceWorker' in navigatorArg)) {
        return;
    }

    // Race against a timeout so the app doesn't hang if the SW is blocked
    // (e.g., in WebKit/Playwright test environments with serviceWorkers:'block').
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 3000));
    const result = await Promise.race([navigatorArg.serviceWorker.ready.then(() => 'ready' as const), timeout]);
    if (result === 'timeout') {
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
