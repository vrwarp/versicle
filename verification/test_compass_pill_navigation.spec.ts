/**
 * Verifies the compass-pill navigation rework (separating page navigation from
 * audio transport):
 *
 *  1. Paginated mode has dedicated page-turn rails (PageTurnRails) at the left/
 *     right edges of the reading column — the affordance that let the pill stop
 *     moonlighting as a page-turner. Clicking a rail turns the page.
 *  2. The compass-pill prev/next arrows are now a PURE AUDIO TRANSPORT: they
 *     skip TTS sections and carry one stable name ("Previous/Next chapter").
 *     They are DISABLED while audio is idle and ENABLED during playback — they
 *     no longer flip between page-turn and section-skip with a hidden TTS state.
 */
import { test, expect } from "./utils";
import {
  resetApp,
  ensureLibraryWithBook,
  navigateToChapter,
  waitForReaderReady,
  captureScreenshot,
} from "./utils";
import type { Page } from "@playwright/test";

/** Live reader CFI via the typed test API (null before a reader mounts). */
async function getCurrentCfi(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__versicleTest?.reader?.currentCfi?.() ?? null);
}

/** Live reader section href via the typed test API. */
async function getCurrentHref(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__versicleTest?.reader?.currentHref?.() ?? null);
}

test("page-turn rails turn pages in paginated mode", async ({ page }) => {
  await resetApp(page);
  await ensureLibraryWithBook(page);

  // Open the book and wait for the engine + locations registry.
  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId("reader-back-button")).toBeVisible();
  await waitForReaderReady(page, { locations: true });

  // The rails render ONLY in paginated mode (the default); scrolled mode
  // navigates by wheel/touch instead. Their presence is the paginated signal.
  const rightRail = page.getByTestId("page-turn-rail-right");
  const leftRail = page.getByTestId("page-turn-rail-left");
  await expect(rightRail).toBeVisible();
  await expect(leftRail).toBeVisible();
  await expect(rightRail).toHaveAttribute("aria-label", "Next page");
  await expect(leftRail).toHaveAttribute("aria-label", "Previous page");

  await captureScreenshot(page, "page_turn_rails");

  // Click a rail and wait for the reader location to move off `prev`. epub.js
  // silently drops a next()/prev() issued while the section is still settling
  // (WebKit under full-suite load), so one re-click is allowed before failing.
  const turnPage = async (rail: typeof rightRail, prev: string | null) => {
    const moved = () =>
      page.waitForFunction(
        (p) => (window.__versicleTest?.reader?.currentCfi?.() ?? null) !== p,
        prev,
        { timeout: 10000 },
      );
    await rail.click();
    await moved().catch(async () => {
      await rail.click();
      await moved();
    });
  };

  // Forward via the right rail — the reader location must change.
  const cfiBefore = await getCurrentCfi(page);
  expect(cfiBefore).not.toBeNull(); // guaranteed by waitForReaderReady's location gate
  await turnPage(rightRail, cfiBefore);
  const cfiAfterNext = await getCurrentCfi(page);
  expect(cfiAfterNext).not.toBe(cfiBefore);

  // Back via the left rail — the location changes again.
  await turnPage(leftRail, cfiAfterNext);
  expect(await getCurrentCfi(page)).not.toBe(cfiAfterNext);
});

test("compass-pill arrows are a pure audio transport (disabled idle, enabled during audio)", async ({ page }) => {
  await resetApp(page);
  await ensureLibraryWithBook(page);

  await page.locator("[data-testid^='book-card-']").first().click();
  await expect(page.getByTestId("reader-back-button")).toBeVisible();

  // A content-rich chapter so the TTS queue populates for playback.
  await navigateToChapter(page);
  await expect(page.getByTestId("compass-pill-active")).toBeVisible({ timeout: 10000 });
  await waitForReaderReady(page);

  const prevChapter = page.getByRole("button", { name: "Previous chapter" });
  const nextChapter = page.getByRole("button", { name: "Next chapter" });

  // Idle: the arrows are present but DISABLED — there is no audio to skip, and
  // page turning lives on the rails / arrow keys now, not these arrows.
  await expect(nextChapter).toBeDisabled();
  await expect(prevChapter).toBeDisabled();
  await captureScreenshot(page, "compass_arrows_disabled_idle");

  // Wait for the TTS queue to build, then start playback from the pill's center.
  await page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => ((window as any).useTTSPlaybackStore?.getState?.().queue?.length ?? 0) > 0,
    undefined,
    { timeout: 15000 },
  );
  await page.getByTestId("compass-active-toggle").click();
  await page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => ((window as any).useTTSPlaybackStore?.getState?.().status ?? "stopped") !== "stopped",
    undefined,
    { timeout: 20000 },
  );

  // Audio active: the SAME arrows are now ENABLED — their name never changed
  // (no "page"↔"chapter" flip under the user).
  await expect(nextChapter).toBeEnabled();
  await expect(prevChapter).toBeEnabled();
  await captureScreenshot(page, "compass_arrows_enabled_playing");

  // The enabled "Next chapter" arrow skips a TTS section: audio-follow moves the
  // reader to the new section, so its href advances.
  const hrefBefore = await getCurrentHref(page);
  await nextChapter.click();
  await page.waitForFunction(
    (prev) => (window.__versicleTest?.reader?.currentHref?.() ?? null) !== prev,
    hrefBefore,
    { timeout: 15000 },
  );
  expect(await getCurrentHref(page)).not.toBe(hrefBefore);

  // Cleanup: stop playback so teardown is quiet.
  await page.evaluate(() => window.__versicleTest?.tts?.pause?.());
});
