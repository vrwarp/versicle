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
 * to enforcing as the known violations (aria-hidden-focus on note markers,
 * nested-interactive in BookCard/VocabTile, the unnamed reader iframe) are
 * burned down by their owning Phase 1+ workstreams.
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

async function scanSurface(page: Page, testInfo: TestInfo, surface: string): Promise<void> {
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

  await scanSurface(page, testInfo, 'reader');
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
