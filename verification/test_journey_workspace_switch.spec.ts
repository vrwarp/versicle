import { test, expect, openSettings } from "./utils";

test("journey workspace switch", async ({ page }) => {
  // Navigate to app
  await page.addInitScript("window.__VERSICLE_MOCK_FIRESTORE__ = true;");
  // Collapse the MockFireProvider save/download debounce (default 2000ms) so the
  // two staged-swap reloads (STAGED apply → AWAITING_CONFIRMATION) complete fast
  // — the same determinism knob the Firestore-sync journey uses. Without it the
  // create→switch-back round trip can push the confirmation modal past the wait.
  await page.addInitScript("window.__VERSICLE_FIRESTORE_DEBOUNCE_MS__ = 20;");
  await page.goto("/");

  // Bypass the intro dialog if it appears
  try {
    await page.getByRole("button", { name: "Continue" }).click({ timeout: 2000 });
  } catch {
    // Ignore
  }

  // Open Global Settings. Settings is now the Radix-Tabs SettingsShell at /settings/:tab
  // (route-modal over the library); tabs are real role="tab" triggers.
  await openSettings(page);

  // Go to Sync tab
  await page.getByRole("tab", { name: "Sync & Cloud" }).scrollIntoViewIfNeeded().catch(() => {});
  await page.getByRole("tab", { name: "Sync & Cloud" }).click();

  // In mock mode, sync is auto-enabled without pasting config

  // Wait for the workspaces block to appear, which is unlocked after signIn
  // Active workspace should be the auto-provisioned one
  await expect(page.getByText("Active: My Library")).toBeVisible();

  // Let's create a new workspace
  await page.getByPlaceholder("New workspace name").fill("Reading Group");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  // Wait for creation to finish. It automatically switches without a modal (since it's empty)
  // the name Reading Group will be visible in the list (and as the active workspace)
  await expect(page.getByText("Reading Group", { exact: true }).first()).toBeVisible();

  // NOW let's test the actual multi-stage switch by switching BACK to the default workspace.
  // The list should contain the default workspace (e.g., main5) with a Switch button.
  await page.getByRole("button", { name: "Switch" }).first().click();

  // The switch durably stages, reloads to apply, then reloads again into the
  // AWAITING_CONFIRMATION boot arm which surfaces the app-level confirmation
  // modal. (Wait generously to ride out the two reboots under full-suite load.)
  await expect(page.getByRole("heading", { name: "Finalize Workspace Switch?" })).toBeVisible({ timeout: 45000 });

  // The reload lands back on /settings/sync, but SettingsShell steps aside
  // while a migration awaits confirmation (mounting its Radix dialog here
  // would aria-hide the confirmation modal and trap focus beneath it), so the
  // settings overlay must NOT be open and the modal is directly interactable.
  await expect(page.getByRole("tablist", { name: "Settings sections" })).not.toBeVisible({ timeout: 10000 });

  // The modal warns that local data will be synced. A real click (not a
  // dispatched event) pins that no overlay covers the confirmation buttons.
  await page.getByRole("button", { name: "Yes, Finalize" }).click();

  // Now it should close the modal and resume sync
  await expect(page.getByRole("heading", { name: "Finalize Workspace Switch?" })).not.toBeVisible();

  // Re-open Settings to verify the active workspace changed back
  await openSettings(page);
  await page.getByRole("tab", { name: "Sync & Cloud" }).scrollIntoViewIfNeeded().catch(() => {});
  await page.getByRole("tab", { name: "Sync & Cloud" }).click();

  // The library should now be connected back to the first workspace
  await expect(page.getByText("Active: My Library")).toBeVisible();
});
