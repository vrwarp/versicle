/**
 * Jank instrumentation spec — the interaction-smoothness counterpart to
 * test_perf_baseline.spec.ts (which times the load path).
 *
 * Not a pass/fail journey: it drives the interactions that historically
 * janked — the Chinese pinyin overlay's full-chapter pass (enable, page
 * turns, scroll-settle remeasures, pinyin-size changes) on a LARGE zh book
 * (verification/test_chinese_large.epub, ~13.5k Han chars over 3 chapters,
 * emitted by create_perf_chinese_epub.cjs) — under 4x CPU throttling
 * (CDP, Chromium only — approximates a mid-range phone) and records, per
 * step:
 *
 *  - main-thread long tasks (PerformanceObserver 'longtask', Chromium),
 *  - requestAnimationFrame gaps > 33ms (dropped-frame proxy) and the
 *    blocking time they imply (sum of gap - 16ms),
 *  - the app's own chinese:* / reader:* User Timing measures,
 *  - overlay span counts (the rendered-DOM cost driver).
 *
 * Results are printed to the report and written as JSON to
 * verification/perf-results/jank-<project>.json so runs before/after a
 * change can be diffed.
 *
 * Run it one project at a time (it is a measurement, parallel load skews it):
 *   npx playwright test verification/test_perf_jank.spec.ts --project=desktop --workers=1
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from './utils';
import * as utils from './utils';
import type { Page } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.use({ sanitizationDisabled: false });

/**
 * Injected before the app: buffers long tasks (Chromium) and rAF gaps >50ms
 * into window arrays the test snapshots-and-clears per step.
 */
const JANK_SAMPLER = `(() => {
  const longTasks = [];
  const frameGaps = [];
  window.__jankLongTasks = longTasks;
  window.__jankFrameGaps = frameGaps;
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const a = (e.attribution && e.attribution[0]) || {};
        longTasks.push({
          at: Math.round(e.startTime),
          dur: Math.round(e.duration),
          src: [e.name, a.containerType, a.containerName || a.containerSrc].filter(Boolean).join(':'),
        });
      }
    });
    po.observe({ type: 'longtask', buffered: true });
  } catch { /* WebKit/Firefox: frame gaps only */ }
  let last = performance.now();
  const loop = (now) => {
    const d = now - last;
    if (d > 33) frameGaps.push({ at: Math.round(now), gap: Math.round(d) });
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();`;

interface JankSample {
  longTasks: Array<{ at: number; dur: number; src?: string }>;
  frameGaps: Array<{ at: number; gap: number }>;
  /** chinese:process-section measures landed since the previous drain. */
  processPasses: number[];
}

interface StepReport {
  name: string;
  wallMs: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  longTaskMaxMs: number;
  frameGapCount: number;
  frameGapMaxMs: number;
  /** Sum over recorded gaps of (gap - one 16ms frame) — est. blocked time. */
  blockedMs: number;
  /** chinese:process-section pass wall-durations landed during the step. */
  processPasses: number[];
  /** Raw long tasks with attribution, for drill-down. */
  longTaskDetail: string[];
}

/** Snapshot AND CLEAR the in-page jank buffers. */
async function drainJank(page: Page): Promise<JankSample> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __jankLongTasks?: Array<{ at: number; dur: number; src?: string }>;
      __jankFrameGaps?: Array<{ at: number; gap: number }>;
      __jankMeasureCursor?: number;
    };
    const longTasks = (w.__jankLongTasks ?? []).splice(0);
    const frameGaps = (w.__jankFrameGaps ?? []).splice(0);
    const measures = performance
      .getEntriesByType('measure')
      .filter((m) => m.name === 'chinese:process-section');
    const cursor = w.__jankMeasureCursor ?? 0;
    w.__jankMeasureCursor = measures.length;
    const processPasses = measures.slice(cursor).map((m) => Math.round(m.duration));
    return { longTasks, frameGaps, processPasses };
  });
}

function summarize(name: string, wallMs: number, sample: JankSample): StepReport {
  const durs = sample.longTasks.map((t) => t.dur);
  const gaps = sample.frameGaps.map((g) => g.gap);
  return {
    name,
    wallMs: Math.round(wallMs),
    longTaskCount: durs.length,
    longTaskTotalMs: durs.reduce((a, b) => a + b, 0),
    longTaskMaxMs: durs.length ? Math.max(...durs) : 0,
    frameGapCount: gaps.length,
    frameGapMaxMs: gaps.length ? Math.max(...gaps) : 0,
    blockedMs: gaps.reduce((a, b) => a + Math.max(0, b - 16), 0),
    processPasses: sample.processPasses,
    longTaskDetail: sample.longTasks.map((t) => `${t.dur}ms@${t.at}${t.src ? ` (${t.src})` : ''}`),
  };
}

async function overlaySpanCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.querySelector('[data-testid="reader-iframe-container"]')?.querySelectorAll('.font-pinyin')
        .length ?? 0,
  );
}

async function uploadBook(page: Page, filename: string) {
  const filePath = path.resolve(__dirname, filename);
  const fileBase64 = fs.readFileSync(filePath).toString('base64');
  await page.evaluate(
    ({ base64Data, name }) => {
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const file = new File([new Uint8Array(byteNumbers)], name, { type: 'application/epub+zip' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      document
        .querySelector('[data-testid="library-view"]')!
        .dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true }));
    },
    { base64Data: fileBase64, name: filename },
  );
}

/**
 * Scroll the epub.js container (scrolled-doc mode) the way the app's wheel
 * handler does (useReaderNavigation: viewer mount's firstElementChild).
 */
async function scrollEpubContainer(page: Page, deltaY: number): Promise<void> {
  await page.evaluate((dy) => {
    const mount = document.querySelector('[data-testid="reader-iframe-container"]');
    const container = mount?.firstElementChild as HTMLElement | null;
    container?.scrollBy({ top: dy });
  }, deltaY);
}

/** Vertical scrollability of the epub container — the scrolled-mode signal. */
async function epubContainerScrollable(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const mount = document.querySelector('[data-testid="reader-iframe-container"]');
    const container = mount?.firstElementChild as HTMLElement | null;
    return !!container && container.scrollHeight > container.clientHeight + 10;
  });
}

test('jank baseline: pinyin overlay enable, page turns, size change, scrolled-mode scrolling', async ({ page }, testInfo) => {
  test.setTimeout(300000);

  const steps: StepReport[] = [];
  const extras: Record<string, unknown> = {};

  await page.addInitScript({ content: JANK_SAMPLER });
  await utils.resetApp(page);

  // 4x CPU throttle (Chromium only): jank that a desktop CPU absorbs under
  // the 50ms long-task floor becomes visible, approximating a mid phone.
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    extras.cpuThrottle = 4;
  } catch {
    extras.cpuThrottle = 1;
  }

  // ---- Import + open the large Chinese book (untimed setup) ----
  await uploadBook(page, 'test_chinese_large.epub');
  const bookCard = page.locator("[data-testid^='book-card-']", { hasText: 'Perf Chinese Book' }).first();
  await expect(bookCard).toBeVisible({ timeout: 30000 });
  await bookCard.click();
  await utils.waitForReaderReady(page);
  await page.waitForTimeout(1500); // let the open settle so it isn't attributed to the first step
  await drainJank(page);

  // ---- Enable pinyin: full-chapter readings + geometry + overlay render ----
  {
    const t0 = Date.now();
    await page.getByTestId('reader-visual-settings-button').click();
    const langSelect = page.getByTestId('book-language-select');
    await expect(langSelect).toBeVisible({ timeout: 5000 });
    if ((await langSelect.innerText()).includes('en')) {
      await langSelect.click();
      await page.getByRole('option', { name: 'Chinese (zh)' }).click();
      await page.waitForTimeout(500);
    }
    const pinyinSwitch = page.getByTestId('show-pinyin-switch');
    if ((await pinyinSwitch.getAttribute('data-state')) !== 'checked') {
      await pinyinSwitch.click();
    }
    await expect.poll(() => overlaySpanCount(page), { timeout: 30000 }).toBeGreaterThan(50);
    const wall = Date.now() - t0;
    await page.mouse.click(10, 10); // close the popover
    await page.waitForTimeout(800); // catch trailing remeasure work
    steps.push(summarize('enable-pinyin->spans-visible', wall, await drainJank(page)));
    extras.spanCountAfterEnable = await overlaySpanCount(page);
  }

  // ---- Paginated page turns (each fires relocated -> overlay remeasure) ----
  {
    const t0 = Date.now();
    for (let i = 1; i <= 6; i += 1) {
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
      await page.waitForTimeout(350); // window for the post-relocation remeasure
    }
    steps.push(summarize('page-turns-x6', Date.now() - t0, await drainJank(page)));
  }

  // ---- Pinyin size change (overlay-only preference) ----
  {
    const t0 = Date.now();
    await page.getByTestId('reader-visual-settings-button').click();
    await page.getByRole('button', { name: 'Increase pinyin size' }).click();
    await page.waitForTimeout(600);
    await page.mouse.click(10, 10);
    await page.waitForTimeout(400);
    steps.push(summarize('pinyin-size-change', Date.now() - t0, await drainJank(page)));
  }

  // ---- Switch to scrolled mode ----
  {
    const t0 = Date.now();
    await page.getByTestId('reader-visual-settings-button').click();
    // The zh-book settings popover is taller than the viewport, so the tab
    // can sit outside it — Radix tabs activate on focus (automatic mode).
    await page.getByRole('tab', { name: 'Scrolled' }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => epubContainerScrollable(page), { timeout: 30000 }).toBe(true);
    await page.mouse.click(10, 10);
    await expect.poll(() => overlaySpanCount(page), { timeout: 30000 }).toBeGreaterThan(50);
    // Long settle: the fresh scrolled view's overlay commit + first paint
    // must be attributed HERE, not to the scrolling step that follows.
    await page.waitForTimeout(1500);
    steps.push(summarize('switch-to-scrolled', Date.now() - t0, await drainJank(page)));
  }

  // ---- Scrolled-mode scrolling: each pause fires the 20ms-debounced
  //      'scrolled' -> relocated -> overlay remeasure pipeline ----
  {
    const t0 = Date.now();
    for (let i = 0; i < 12; i += 1) {
      await scrollEpubContainer(page, 320);
      await page.waitForTimeout(140); // pause long enough for the scroll-settle relocation
    }
    await page.waitForTimeout(800); // trailing remeasure work
    steps.push(summarize('scrolled-scrolling-x12', Date.now() - t0, await drainJank(page)));
  }

  // ---- App-side User Timing measures (chinese pass instrumentation) ----
  extras.appMeasures = await page.evaluate(() =>
    performance
      .getEntriesByType('measure')
      .filter((m) => /^(chinese|reader):/.test(m.name))
      .slice(-40)
      .map((m) => ({ name: m.name, dur: Math.round(m.duration) })),
  );
  extras.finalSpanCount = await overlaySpanCount(page);

  const results = {
    project: testInfo.project.name,
    timestamp: new Date().toISOString(),
    steps,
    ...extras,
  };

  const outDir = path.resolve(__dirname, 'perf-results');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `jank-${testInfo.project.name}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.warn(`[jank] results written to ${outPath}`);
  console.warn(JSON.stringify(steps, null, 2));
});
