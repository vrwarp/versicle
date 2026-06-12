/**
 * @axe-core/playwright scans of the app's core surfaces (gap-accessibility
 * report, debt #6 layer 3): library grid, reader, global settings dialog,
 * audio deck.
 *
 * Phase 0 BASELINE MODE (plan/overhaul/README.md §4 rule 3 — new tooling
 * lands at warn until clean): each scan always runs, prints a summary, and
 * attaches the full violation list as a JSON artifact, but only FAILS on
 * serious/critical violations when A11Y_ENFORCE=1 is set. The first nightly
 * runs' artifacts are the data for the committed baseline; the gate flips
 * to enforcing as the known violations (nested-interactive in
 * BookCard/VocabTile) are burned down by their owning workstreams.
 *
 * Phase 6 ratchet (prep/phase6-reader-engine.md §4 / PR-9): the reader
 * surface's P0 baseline findings are FIXED and now assert ALWAYS, not just
 * under A11Y_ENFORCE —
 *   - frame-title: the engine titles every section iframe at content
 *     render (EpubJsEngine content hook, the C7 SR contract),
 *   - aria-hidden-focus: note markers ride the ReaderOverlay
 *     'interactive' contract (focusable buttons never inside an
 *     aria-hidden container),
 *   - region (landmark): the reader body is a real <main> landmark
 *     (ReaderShell); the header is the <header> banner; since Phase 8 the
 *     pill mount (ReaderControlBar) is a named region landmark — 'region'
 *     asserts as fixed on the reader surface.
 * A regression in these named rules fails the nightly lane outright.
 *
 * Runs in the existing Docker flow (nightly lane), e.g.:
 *   ./run_verification.sh --project=desktop --grep @a11y
 */
import { AxeBuilder } from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './utils';
import * as utils from './utils';

const ENFORCE = !!process.env.A11Y_ENFORCE;

/** WCAG A/AA + best-practice rule tags — the standard axe gate. */
const RULE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

async function scanSurface(
  page: Page,
  testInfo: TestInfo,
  surface: string,
  opts: {
    /**
     * Rules whose P0-baseline findings were fixed by an owning workstream:
     * ANY violation of these (regardless of impact, regardless of
     * A11Y_ENFORCE) fails the scan — the per-rule ratchet that burns the
     * baseline down without flipping the whole gate at once.
     */
    expectAbsentRules?: string[];
  } = {},
): Promise<void> {
  // Parent document only: legacy mode disables axe's frame injection and
  // iframes:false skips frame-content rules. epub.js creates/destroys
  // sandboxed blob iframes during section load and axe's injection hangs or
  // throws on them — and "how AT reads the book content" is an explicitly
  // open contract owned by the ReaderShell phase (gap-accessibility report,
  // debt #5). The <iframe> ELEMENT itself is still audited by the
  // parent-document scan (e.g. frame-title).
  const results = await new AxeBuilder({ page })
    .withTags(RULE_TAGS)
    .options({ iframes: false })
    .setLegacyMode(true)
    .analyze();

  const seriousOrCritical = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical'
  );

  await testInfo.attach(`axe-${surface}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });

  // console.warn stays visible under the suite's log suppression.
  const summary = results.violations
    .map((v) => `  [${v.impact ?? 'n/a'}] ${v.id}: ${v.nodes.length} node(s) — ${v.help}`)
    .join('\n');
  console.warn(
    `[a11y] ${surface}: ${results.violations.length} violation rule(s), ` +
      `${seriousOrCritical.length} serious/critical${summary ? `\n${summary}` : ''}`
  );

  // The scan itself must have executed against a real surface.
  expect(results.passes.length + results.violations.length).toBeGreaterThan(0);

  // Per-rule ratchet: fixed baseline findings must stay fixed.
  if (opts.expectAbsentRules?.length) {
    const regressed = results.violations.filter((v) => opts.expectAbsentRules!.includes(v.id));
    expect(
      regressed.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
      `regressed fixed-baseline axe rules on ${surface}`
    ).toEqual([]);
  }

  if (ENFORCE) {
    expect(
      seriousOrCritical.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
      `serious/critical axe violations on ${surface}`
    ).toEqual([]);
  }
}

test('a11y scan: library grid', { tag: '@a11y' }, async ({ page }, testInfo) => {
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);
  await expect(page.locator("[data-testid^='book-card-']").first()).toBeVisible();

  await scanSurface(page, testInfo, 'library');
});

test('a11y scan: reader surface', { tag: '@a11y' }, async ({ page }, testInfo) => {
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId('reader-view')).toBeVisible();
  // Let the epub iframe render its first section before scanning.
  await expect
    .poll(() => utils.getReaderFrame(page) !== null, { timeout: 15000 })
    .toBe(true);

  // Phase 6 fixed findings (see header): titled iframe + interactive
  // note-marker overlay. 'region' joined with Phase 8: the CompassPill
  // dissolved (§C) and the pill mount is a named region landmark
  // (ReaderControlBar) — every reader-surface node now lives inside a
  // landmark.
  await scanSurface(page, testInfo, 'reader', {
    expectAbsentRules: ['frame-title', 'aria-hidden-focus', 'region'],
  });
});

test('a11y scan: global settings dialog', { tag: '@a11y' }, async ({ page }, testInfo) => {
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);
  await page.getByTestId('header-settings-button').click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await scanSurface(page, testInfo, 'settings-dialog');
});

test('a11y scan: audio deck panel', { tag: '@a11y' }, async ({ page }, testInfo) => {
  await utils.resetApp(page);
  await utils.ensureLibraryWithBook(page);
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId('reader-view')).toBeVisible();
  await page.getByLabel('Open Audio Deck').click();
  await expect(page.getByTestId('tts-panel')).toBeVisible();

  await scanSurface(page, testInfo, 'audio-panel');
});
