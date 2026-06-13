/**
 * Kill-mid-switch journey (phase4-sync-strangler.md §D4/§D8) — the
 * CI-permanent crash-resume proof for the staged workspace swap, against
 * the mock backend.
 *
 * The §D4 failure table, asserted row by row by killing the page at each
 * deterministic pause point (`window.__VERSICLE_SWAP_PAUSE__`, read by
 * src/domains/sync/workspaces/stagedSwap.ts via src/test-flags.ts) and
 * reopening in the SAME browser context — IndexedDB and localStorage
 * survive, exactly like process death:
 *
 *   kill at 'swap:staged'        STAGED committed, pre-reload      → resumes
 *   kill at 'swap:before-apply'  boot apply armed, nothing wiped   → resumes
 *   kill at 'swap:mid-apply'     main DB WIPED, rewrite pending    → resumes
 *   (then) finalize              AWAITING_CONFIRMATION modal       → library intact
 *   roll back                    RESTORING_BACKUP restore          → previous
 *                                workspace AND its data return
 *
 * Runs in the Docker/nightly verification lane (run_verification.sh) like
 * every journey here; the vitest half of the acceptance gate is
 * src/domains/sync/workspaces/stagedSwap.test.ts. One WebKit-lane run is
 * required for P4-5 exit (IDB semantics differ — the playwright.config
 * `webkit` project picks this spec up automatically).
 */
import type { BrowserContext, Page } from "@playwright/test";
import { test, expect } from "./utils";

const MIGRATION_STATE_KEY = "__VERSICLE_MIGRATION_STATE__";

type PausePoint = "swap:staged" | "swap:before-apply" | "swap:mid-apply";

/** Open a page in the shared context with the mock backend (and optionally
 * a parked swap pause point) armed before the app boots. */
async function openAppPage(context: BrowserContext, pause?: PausePoint): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript(
    `window.__VERSICLE_MOCK_FIRESTORE__ = true;` +
      `window.__VERSICLE_FIRESTORE_DEBOUNCE_MS__ = 50;` +
      (pause ? `window.__VERSICLE_SWAP_PAUSE__ = ${JSON.stringify(pause)};` : "")
  );
  await page.goto("/");
  // Bypass the intro dialog if it appears.
  try {
    await page.getByRole("button", { name: "Continue" }).click({ timeout: 2000 });
  } catch {
    // Ignore
  }
  return page;
}

async function openSyncSettings(page: Page): Promise<void> {
  await page.getByTestId("header-settings-button").click();
  await page.getByRole("tab", { name: "Sync & Cloud" }).scrollIntoViewIfNeeded().catch(() => {});
  await page.getByRole("tab", { name: "Sync & Cloud" }).click();
}

const readMigrationStatus = (page: Page): Promise<string | null> =>
  page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw).status as string) : null;
  }, MIGRATION_STATE_KEY);

test("journey kill-mid-switch: every crash window resumes; rollback restores the previous workspace", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);

  // ── Setup: mock sync, a non-empty library, and a second workspace ───────
  await page.addInitScript("window.__VERSICLE_MOCK_FIRESTORE__ = true; window.__VERSICLE_FIRESTORE_DEBOUNCE_MS__ = 50;");
  await page.goto("/");
  try {
    await page.getByRole("button", { name: "Continue" }).click({ timeout: 2000 });
  } catch {
    // Ignore
  }

  // Library non-empty: the demo book is the journey's data canary.
  const loadBtn = page.getByRole("button", { name: "Load Demo Book" });
  await loadBtn.click();
  await expect(page.locator("[data-testid^='book-card-']").first()).toBeVisible({
    timeout: 30000,
  });
  await page.evaluate(() => window.__versicleTest?.flushPersistence());

  await openSyncSettings(page);
  await expect(page.getByText("Active: My Library")).toBeVisible({ timeout: 15000 });

  // Create "Target" — empty remote, so it auto-switches without a modal and
  // the local library (incl. the demo book) becomes its source of truth.
  await page.getByPlaceholder("New workspace name").fill("Target");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Active: Target")).toBeVisible({ timeout: 20000 });
  // Let the mock provider flush the workspace snapshot to "cloud" storage.
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__versicleTest?.flushPersistence());

  // ── Kill 1: at 'swap:staged' (STAGED committed, before the reload) ──────
  await page.evaluate(() => {
    (window as unknown as { __VERSICLE_SWAP_PAUSE__?: string }).__VERSICLE_SWAP_PAUSE__ =
      "swap:staged";
  });
  // Switch back to "My Library" — the staged swap parks right after commit.
  await page.getByRole("button", { name: "Switch" }).first().click();
  await expect.poll(() => readMigrationStatus(page), { timeout: 30000 }).toBe("STAGED");
  await page.close(); // process death; context (IDB + localStorage) survives

  // ── Kill 2: at 'swap:before-apply' (boot STAGED arm, nothing wiped) ─────
  const page2 = await openAppPage(context, "swap:before-apply");
  await expect(page2.getByText("Applying workspace switch...")).toBeVisible({
    timeout: 20000,
  });
  expect(await readMigrationStatus(page2)).toBe("STAGED");
  await page2.close();

  // ── Kill 3: at 'swap:mid-apply' (main DB WIPED, rewrite pending) ────────
  const page3 = await openAppPage(context, "swap:mid-apply");
  await expect(page3.getByText("Applying workspace switch...")).toBeVisible({
    timeout: 20000,
  });
  expect(await readMigrationStatus(page3)).toBe("STAGED");
  await page3.close();

  // ── Resume: unarmed boot applies from staging and raises the modal ──────
  const page4 = await openAppPage(context);
  await expect(
    page4.getByRole("heading", { name: "Finalize Workspace Switch?" })
  ).toBeVisible({ timeout: 30000 });
  await page4.getByRole("button", { name: "Yes, Finalize" }).dispatchEvent("click");
  await expect(
    page4.getByRole("heading", { name: "Finalize Workspace Switch?" })
  ).not.toBeVisible();

  // The switch completed: correct workspace, library non-empty, state clear.
  await expect(page4.locator("[data-testid^='book-card-']").first()).toBeVisible({
    timeout: 30000,
  });
  await openSyncSettings(page4);
  await expect(page4.getByText("Active: My Library")).toBeVisible({ timeout: 15000 });
  expect(await readMigrationStatus(page4)).toBeNull();

  // ── Rollback row: switch again, then Roll Back at the modal ─────────────
  await page4.getByRole("button", { name: "Switch" }).first().click();
  // Two reloads later (commit → apply) the confirm modal appears.
  await expect(
    page4.getByRole("heading", { name: "Finalize Workspace Switch?" })
  ).toBeVisible({ timeout: 60000 });
  await page4.getByRole("button", { name: "Roll Back" }).dispatchEvent("click");

  // The boot interceptor restores the pinned checkpoint and reverts the
  // active-workspace tie (previousWorkspaceId, P4-5) — the user is back on
  // My Library with their data.
  await expect(page4.locator("[data-testid^='book-card-']").first()).toBeVisible({
    timeout: 60000,
  });
  await expect.poll(() => readMigrationStatus(page4), { timeout: 30000 }).toBeNull();
  await openSyncSettings(page4);
  await expect(page4.getByText("Active: My Library")).toBeVisible({ timeout: 15000 });
  await page4.close();
});
