/**
 * Malformed-EPUB journeys (plan/epub-toc-cover-hardening.md §7).
 *
 * The books under verification/fixtures/malformed/ are generated from the
 * specs in src/test/harness/epubFixtures.ts (drift-gated) and reproduce real
 * packaging defects: a nav document in a subfolder whose hrefs are relative
 * to itself, no cover markers in the OPF, links to files outside the spine,
 * bare "Chapter N" labels. Before the hardening, every TOC click in such a
 * book failed silently and the library showed the "Aa" placeholder.
 */
import { test, expect } from './utils';
import * as utils from './utils';
import type { Page } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixture = (name: string) => path.resolve(__dirname, 'fixtures', 'malformed', `${name}.epub`);

async function importAndOpen(page: Page, name: string, title: string) {
  await utils.resetApp(page);
  await page.getByTestId('hidden-file-input').setInputFiles(fixture(name));
  const card = page.locator("[data-testid^='book-card-']").filter({ hasText: title }).first();
  await expect(card).toBeVisible({ timeout: 30000 });
  return card;
}

async function openToc(page: Page) {
  await page.getByTestId('reader-toc-button').click();
  await expect(page.getByTestId('reader-toc-sidebar')).toBeVisible();
}

/** Click a TOC entry and assert the reader lands on `expectedHref`. */
async function jumpVia(page: Page, testId: string, expectedHref: string) {
  const before = await utils.currentSectionHref(page);
  if (!(await page.getByTestId('reader-toc-sidebar').isVisible())) await openToc(page);
  await page.getByTestId(testId).click();
  await expect(page.getByTestId('reader-toc-sidebar')).not.toBeVisible();
  await utils.waitForSectionChange(page, before);
  expect(await utils.currentSectionHref(page)).toBe(expectedHref);
}

test('malformed EPUB: undeclared cover and nav-relative TOC links work', async ({ page }) => {
  const card = await importAndOpen(page, 'nav-subfolder-undeclared-cover', 'Nav In Subfolder');

  // C1: the cover lives only in Text/cover.xhtml (no OPF markers) — the card
  // shows a real, decoded image instead of the placeholder.
  const cover = card.getByRole('img', { name: 'Cover of Nav In Subfolder' });
  await expect(cover).toBeVisible({ timeout: 15000 });
  await expect
    .poll(() => cover.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { timeout: 15000 })
    .toBe(true);
  await utils.captureScreenshot(page, 'malformed_1_library_cover');

  await card.click();
  await utils.waitForReaderReady(page);

  // T1: nav hrefs are `../Text/...` relative to Text/toc.xhtml.
  await openToc(page);
  await expect(page.getByTestId('toc-item-3')).toHaveText('Chapter 1 Why I Wrote This Book');
  await utils.captureScreenshot(page, 'malformed_2_toc');

  await jumpVia(page, 'toc-item-3', 'Text/CH1.xhtml');
  // T3: the nav says CH2.xhtml, the file is Ch2.xhtml.
  await jumpVia(page, 'toc-item-4', 'Text/Ch2.xhtml');

  // The stored ("synthetic") TOC navigates too.
  await openToc(page);
  await page.locator('#synthetic-toc-mode').click();
  await expect(page.locator('#synthetic-toc-mode')).toHaveAttribute('aria-checked', 'true');
  await jumpVia(page, 'toc-item-2', 'Text/CH1_Opener.xhtml');
  await utils.captureScreenshot(page, 'malformed_3_after_synthetic_jump');
});

test('malformed EPUB: broken TOC entries are greyed out and explain themselves', async ({ page }) => {
  const card = await importAndOpen(page, 'toc-structure-edge-cases', 'Toc Edge Cases');
  await card.click();
  await utils.waitForReaderReady(page);
  await openToc(page);

  const sidebar = page.getByTestId('reader-toc-sidebar');
  // T7: bare "Chapter N" labels were replaced — from the NCX ("The
  // Beginning") or the chapter's own heading ("The Long Road").
  await expect(sidebar.getByText('The Beginning')).toBeVisible();
  await expect(sidebar.getByText('The Long Road')).toBeVisible();

  // T5: a link to a file outside the spine and one to a missing file.
  const missing = sidebar.getByRole('button', { name: 'Missing Chapter' });
  await expect(missing).toHaveAttribute('data-unresolved', 'true');
  await expect(sidebar.getByRole('button', { name: 'Appendix (not in spine)' })).toHaveAttribute(
    'data-unresolved',
    'true',
  );
  await utils.captureScreenshot(page, 'malformed_4_greyed_entries');

  // aria-disabled (screen readers announce it as unavailable) but still
  // clickable so it can explain itself; Playwright's actionability check
  // treats aria-disabled as disabled, so the click is forced.
  await missing.click({ force: true });
  await expect(page.getByText('This chapter link is broken in the book file.')).toBeVisible();
  // The sidebar stays open: nothing jumped.
  await expect(sidebar).toBeVisible();

  // A working entry still navigates (T6: fragment-only child of ch2).
  const before = await utils.currentSectionHref(page);
  await sidebar.getByRole('button', { name: 'A Subsection' }).click();
  await expect(sidebar).not.toBeVisible();
  await utils.waitForSectionChange(page, before);
  expect(await utils.currentSectionHref(page)).toBe('Text/ch2.xhtml');
});
