import { test, expect } from "./utils";

test("journey workspace switch", async ({ page }) => {
  // Navigate to app
  await page.addInitScript("window.__VERSICLE_MOCK_FIRESTORE__ = true;");
  await page.goto("/");

  // Bypass the intro dialog if it appears
  try {
    await page.getByRole("button", { name: "Continue" }).click({ timeout: 2000 });
  } catch {
    // Ignore
  }

  // Open Global Settings
  await page.getByTestId("header-settings-button").click();

  // Go to Sync tab
  await page.getByRole("button", { name: "Sync & Cloud" }).click();

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

  // This should trigger the confirmation modal! (Wait up to 20s because empty workspaces rely on an 8s timeout before reloading)
  await expect(page.getByRole("heading", { name: "Finalize Workspace Switch?" })).toBeVisible({ timeout: 20000 });

  // The modal warns that local data will be synced
  await page.getByRole("button", { name: "Yes, Finalize" }).click();

  // Now it should close the modal and resume sync
  await expect(page.getByRole("heading", { name: "Finalize Workspace Switch?" })).not.toBeVisible();

  // Re-open Settings to verify the active workspace changed back
  await page.getByTestId("header-settings-button").click();
  await page.getByRole("button", { name: "Sync & Cloud" }).click();

  // The library should now be connected back to the first workspace
  await expect(page.getByText("Active: My Library")).toBeVisible();
});
