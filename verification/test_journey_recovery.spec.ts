import { test, expect } from "./utils";

test("recovery flow", async ({ page }) => {
  // 1. Open App
  console.log("Opening App...");
  await page.goto("http://localhost:5173");

  // Wait for app to load
  await page.waitForTimeout(3000);

  // 2. Open Settings
  console.log("Opening Settings...");
  const settingsBtn = page.getByRole("button", { name: "Settings" });
  if (!(await settingsBtn.isVisible())) {
    console.log("Settings button not found. Dumping accessible buttons:");
    const buttons = await page.getByRole("button").all();
    for (const btn of buttons) {
      console.log(`- ${await btn.textContent()} | ${await btn.getAttribute("aria-label")}`);
    }
  }

  await expect(settingsBtn).toBeVisible();
  await settingsBtn.click();

  // 3. Go to Recovery Tab
  console.log("Navigating to Recovery Tab...");
  const recoveryTab = page.getByRole("button", { name: "Recovery" });
  await expect(recoveryTab).toBeVisible();
  await recoveryTab.click();

  // 4. Create Snapshot
  console.log("Creating Snapshot...");
  const createBtn = page.getByRole("button", { name: "Create Snapshot" });
  await expect(createBtn).toBeVisible();
  await createBtn.click();

  // Wait for toast or list update
  await page.waitForTimeout(2000);

  // 5. Verify Snapshot in List
  console.log("Verifying Snapshot...");
  const manualBadge = page.getByText("manual").first();
  await expect(manualBadge).toBeVisible();

  // 6. Inspect
  console.log("Inspecting...");
  const inspectBtn = page.getByRole("button", { name: "Inspect" }).first();
  await inspectBtn.click();

  // 7. Check Inspector View
  console.log("Checking Inspector View...");
  await expect(page.getByText("Checkpoint Inspection")).toBeVisible();
});
