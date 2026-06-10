import { test, expect } from '@playwright/test';

/**
 * Verifies that the TTS orchestration engine genuinely runs inside a real Web Worker.
 *
 * `window.__ttsWorkerSmokeTest` (installed in src/main.tsx) boots the worker — which loads
 * the entire engine module graph off the main thread (exercising worker import-safety) — and
 * drives a setQueue → getQueue round-trip plus a status subscription across the Comlink
 * boundary. If the worker failed to import or the bridge were broken, this would throw/time out.
 */
test('TTS engine runs in a real Web Worker (queue round-trip across the boundary)', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));

    await page.goto('/');
    await page.waitForLoadState('networkidle').catch(() => { /* SPA may keep connections open */ });

    await page.waitForFunction(
        () => typeof window.__ttsWorkerSmokeTest === 'function',
        null,
        { timeout: 30000 },
    );

    // Fire the smoke test and stash the result on window, decoupled from this evaluate's
    // context (the worker round-trip is async and the SPA may re-render meanwhile).
    await page.evaluate(() => {
        (window as unknown as { __smoke?: unknown }).__smoke = undefined;
        window.__ttsWorkerSmokeTest!()
            .then((r) => { (window as unknown as { __smoke: unknown }).__smoke = r; })
            .catch((e) => { (window as unknown as { __smoke: unknown }).__smoke = { error: String(e) }; });
    });

    await page.waitForFunction(
        () => (window as unknown as { __smoke?: unknown }).__smoke !== undefined,
        null,
        { timeout: 30000 },
    );

    const result = await page.evaluate(() => (window as unknown as { __smoke: { ok?: boolean; queueLength?: number; status?: string | null; error?: string } }).__smoke);

    if (result.error) {
        throw new Error(`Worker smoke test failed: ${result.error}\nConsole errors:\n${errors.join('\n')}`);
    }

    expect(result.ok).toBe(true);
    expect(result.queueLength).toBe(1);
    expect(result.status).not.toBeNull();
});

/**
 * Verifies the app runs on the worker: the engine the app talks to (`getAudioPlayer()`) is the
 * worker-backed handle, and a store-facing call routes through the worker to the main-thread
 * backend and back.
 */
test('the app engine (getAudioPlayer) is worker-backed and routes through the Worker', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle').catch(() => { /* SPA keeps connections open */ });
    await page.waitForFunction(() => typeof window.__ttsWorkerHandleTest === 'function', null, { timeout: 30000 });

    await page.evaluate(() => {
        (window as unknown as { __h?: unknown }).__h = undefined;
        window.__ttsWorkerHandleTest!()
            .then((r) => { (window as unknown as { __h: unknown }).__h = r; })
            .catch((e) => { (window as unknown as { __h: unknown }).__h = { error: String(e) }; });
    });
    await page.waitForFunction(() => (window as unknown as { __h?: unknown }).__h !== undefined, null, { timeout: 30000 });
    const r = await page.evaluate(() => (window as unknown as { __h: { engineName?: string; voicesIsArray?: boolean; ready?: boolean; error?: string } }).__h);

    if (r.error) throw new Error(`Worker handle test failed: ${r.error}`);

    expect(r.engineName).toBe('WorkerEngineHandle');
    expect(r.voicesIsArray).toBe(true);
    expect(r.ready).toBe(true);
});
