export async function waitForServiceWorkerController(
    navigatorArg: Navigator = navigator,
    maxAttempts = 8,
    initialDelay = 5
): Promise<void> {
    if (!('serviceWorker' in navigatorArg)) {
        return;
    }

    await navigatorArg.serviceWorker.ready;

    let attempt = 0;
    let delay = initialDelay;

    while (!navigatorArg.serviceWorker.controller) {
        if (attempt >= maxAttempts) {
            throw new Error(`Controller still not ready after ${attempt} attempts`);
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
        attempt++;
    }
}
