/**
 * Performance-baseline instrumentation spec.
 *
 * Not a pass/fail journey: it drives the core user flows (cold boot, demo-book
 * import, book open, page turns, warm reload) and records wall-clock step
 * timings plus in-page telemetry — boot-task User Timing measures (emitted by
 * src/app/bootstrap.ts), navigation/paint timing, the slowest network
 * resources, and main-thread stalls captured by a requestAnimationFrame
 * frame-gap sampler. Results are printed to the report and written as JSON to
 * verification/perf-results/<project>.json so runs across projects
 * (webkit vs desktop) can be diffed.
 *
 * Run it one project at a time (it is a measurement, parallel load skews it):
 *   npx playwright test verification/test_perf_baseline.spec.ts --project=webkit --workers=1
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { test } from './utils';
import { resetApp, waitForReaderReady } from './utils';
import type { Page } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LIBRARY_READY_SELECTOR =
  "[data-testid^='book-card-'], button:has-text('Load Demo Book'), :text('Your library is empty')";

/**
 * Injected before the app: records requestAnimationFrame gaps > 50ms — a
 * portable long-task proxy (WebKit has no PerformanceLongTaskTiming).
 */
const FRAME_GAP_SAMPLER = `(() => {
  const gaps = [];
  window.__frameGaps = gaps;
  let last = performance.now();
  const loop = (now) => {
    const d = now - last;
    if (d > 50) gaps.push({ at: Math.round(now), gap: Math.round(d) });
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();`;

interface StepTiming {
  name: string;
  ms: number;
}

interface PageMetrics {
  nav: { responseEnd: number; domContentLoaded: number; load: number } | null;
  paints: Array<{ name: string; t: number }>;
  bootMeasures: Array<{ name: string; start: number; dur: number }>;
  resourceCount: number;
  slowestResources: Array<{ name: string; dur: number; size: number }>;
}

async function collectPageMetrics(page: Page): Promise<PageMetrics> {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    const paints = performance
      .getEntriesByType('paint')
      .map((p) => ({ name: p.name, t: Math.round(p.startTime) }));
    const bootMeasures = performance
      .getEntriesByType('measure')
      .filter((m) => /^(boot|import|reader):/.test(m.name))
      .map((m) => ({
        name: m.name,
        start: Math.round(m.startTime),
        dur: Math.round(m.duration),
      }));
    const resources = performance.getEntriesByType(
      'resource',
    ) as PerformanceResourceTiming[];
    const slowestResources = [...resources]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 12)
      .map((r) => ({
        name: r.name.replace(/^.*\/\/[^/]+/, ''),
        dur: Math.round(r.duration),
        size: r.transferSize,
      }));
    return {
      nav: nav
        ? {
            responseEnd: Math.round(nav.responseEnd),
            domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
            load: Math.round(nav.loadEventEnd),
          }
        : null,
      paints,
      bootMeasures,
      resourceCount: resources.length,
      slowestResources,
    };
  });
}

async function collectFrameGaps(
  page: Page,
): Promise<Array<{ at: number; gap: number }>> {
  return page.evaluate(
    () =>
      (window as unknown as { __frameGaps?: Array<{ at: number; gap: number }> })
        .__frameGaps ?? [],
  );
}

test('performance baseline: boot, import, open, page turns, warm reload', async ({ page }, testInfo) => {
  test.setTimeout(300000);

  const steps: StepTiming[] = [];
  const timed = async (name: string, fn: () => Promise<void>) => {
    const t0 = Date.now();
    await fn();
    const ms = Date.now() - t0;
    steps.push({ name, ms });
    console.warn(`[perf] ${name}: ${ms}ms`);
  };

  await page.addInitScript({ content: FRAME_GAP_SAMPLER });

  // Setup (untimed): wipe all state so the boot below is a true cold boot.
  await resetApp(page);

  // ---- Cold boot: fresh navigation to the library on an empty profile ----
  await timed('cold-boot->library-ready', async () => {
    await page.goto('/', { timeout: 60000 });
    await page.waitForSelector(LIBRARY_READY_SELECTOR, { timeout: 60000 });
  });
  const coldBoot = await collectPageMetrics(page);
  const coldBootGaps = await collectFrameGaps(page);

  // ---- Import the demo book ----
  await timed('import-demo-book->card-visible', async () => {
    await page.getByRole('button', { name: 'Load Demo Book' }).click();
    await page.waitForSelector("[data-testid^='book-card-']", { timeout: 60000 });
  });

  // ---- Open the book, first render ----
  await timed('open-book->reader-ready', async () => {
    await page.locator("[data-testid^='book-card-']").first().click();
    await waitForReaderReady(page);
  });
  const openBookGaps = await collectFrameGaps(page);

  // ---- Page turns (reader engine next(), wait for the CFI to move) ----
  for (let i = 1; i <= 5; i += 1) {
    await timed(`page-turn-${i}`, async () => {
      await page.evaluate(async () => {
        const reader = window.__versicleTest?.reader;
        if (!reader) throw new Error('reader test API unavailable');
        const before = reader.currentCfi();
        await reader.next();
        await new Promise<void>((resolve, reject) => {
          const deadline = Date.now() + 15000;
          const poll = () => {
            if (reader.currentCfi() !== before) return resolve();
            if (Date.now() > deadline) return reject(new Error('CFI did not change after next()'));
            setTimeout(poll, 16);
          };
          poll();
        });
      });
    });
  }

  // ---- Locations registry (background generation gates the % scrubber) ----
  // Usable: the first sections' locations have landed (scrubber can work).
  await timed('locations-usable-after-turns', async () => {
    await page.waitForFunction(
      () => (window.__versicleTest?.reader?.locationsTotal?.() ?? 0) > 0,
      null,
      { timeout: 120000 },
    );
  });
  // Complete: the whole registry generated (reader:locations-generate measure
  // emitted) or loaded from cache (reader:locations-load).
  await timed('locations-complete-after-turns', async () => {
    await page.waitForFunction(
      () =>
        performance
          .getEntriesByType('measure')
          .some((m) => m.name === 'reader:locations-generate' || m.name === 'reader:locations-load'),
      null,
      { timeout: 120000 },
    );
  });

  // Snapshot the SPA session's measures (import + reader phases) before the
  // reload below wipes the performance timeline.
  const session = await collectPageMetrics(page);

  // ---- Warm reload: library boot with populated DB + service worker ----
  await timed('warm-reload->library-ready', async () => {
    await page.goto('/', { timeout: 60000 });
    await page.reload({ timeout: 60000 });
    await page.waitForSelector(LIBRARY_READY_SELECTOR, { timeout: 60000 });
  });
  const warmBoot = await collectPageMetrics(page);
  const warmBootGaps = await collectFrameGaps(page);

  const results = {
    project: testInfo.project.name,
    timestamp: new Date().toISOString(),
    steps,
    coldBoot,
    coldBootGaps,
    openBookGaps,
    session,
    warmBoot,
    warmBootGaps,
  };

  const outDir = path.resolve(__dirname, 'perf-results');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${testInfo.project.name}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.warn(`[perf] results written to ${outPath}`);
  console.warn(JSON.stringify({ steps, sessionMeasures: session.bootMeasures }, null, 2));
});
