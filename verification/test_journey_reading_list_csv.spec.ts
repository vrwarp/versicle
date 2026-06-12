import { test, expect } from "./utils";
import { resetApp, captureScreenshot } from "./utils";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("reading list csv journey", async ({ page }) => {
  console.log("Starting Reading List CSV Journey...");
  await resetApp(page);

  // 1. Make sure Alice in wonderland (demo book) is loaded but do NOT open it
  console.log("Uploading book...");
  const alicePath = path.resolve(__dirname, "alice.epub");
  if (!fs.existsSync(alicePath)) {
    throw new Error("verification/alice.epub not found");
  }

  const fileInput = page.getByTestId("hidden-file-input");
  await fileInput.setInputFiles(alicePath);

  const bookCard = page.locator("[data-testid^='book-card-']").first();
  await expect(bookCard).toBeVisible();

  await expect(bookCard.locator("[data-testid='book-title']")).toContainText("Alice's Adventures in Wonderland");
  await expect(bookCard.locator("[data-testid='progress-bar']")).not.toBeVisible();

  // 2. Open settings, go to data management, and download the reading list
  console.log("Opening Settings -> Data Management...");
  await page.getByTestId("header-settings-button").click();
  await page.getByRole("tab", { name: "Data Management" }).click();

  console.log("Downloading Reading List...");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export to CSV" }).click();
  const download = await downloadPromise;

  const downloadPath = path.resolve(__dirname, "downloaded_reading_list.csv");
  if (fs.existsSync(downloadPath)) {
    fs.unlinkSync(downloadPath);
  }
  await download.saveAs(downloadPath);
  console.log(`Downloaded to ${downloadPath}`);

  // 3. Verify that the downloaded reading list contains Alice in wonderland
  console.log("Verifying content...");
  const csvContent = fs.readFileSync(downloadPath, "utf8");
  const lines = csvContent.split(/\r?\n/).filter(line => line.trim() !== "");

  if (lines.length === 0) {
    throw new Error("Downloaded CSV is empty");
  }

  // Parse header
  // Simple CSV parser for this specific test case
  const header = lines[0].split(",");
  const titleIdx = header.indexOf("Title");
  const percentIdx = header.indexOf("Percentage");

  if (titleIdx === -1 || percentIdx === -1) {
    throw new Error(`CSV missing required columns. Header: ${header}`);
  }

  let aliceRowIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(",");
    if (row[titleIdx] && row[titleIdx].includes("Alice's Adventures in Wonderland")) {
      aliceRowIndex = i;
      break;
    }
  }

  if (aliceRowIndex === -1) {
    throw new Error("Alice's Adventures in Wonderland not found in CSV");
  }
  console.log("Alice found in CSV.");

  // 4. Edit the downloaded reading list to advance the progress to 0.5 (50%)
  console.log("Modifying CSV...");
  const rowCells = lines[aliceRowIndex].split(",");
  rowCells[percentIdx] = "0.5";
  lines[aliceRowIndex] = rowCells.join(",");

  const modifiedPath = path.resolve(__dirname, "modified_reading_list.csv");
  fs.writeFileSync(modifiedPath, lines.join("\n"), "utf8");
  console.log(`Saved modified CSV to ${modifiedPath}`);

  // 5. In the settings, import the reading list
  console.log("Importing modified Reading List...");
  await page.getByTestId("reading-list-csv-input").setInputFiles(modifiedPath);

  // Wait for completion message
  await expect(page.getByText("Import Complete", { exact: true })).toBeVisible({ timeout: 10000 });

  // Click "Return to Library"
  await page.getByRole("button", { name: "Return to Library" }).click();

  // 6. Go back to the library view and make sure that Alice in wonderland shows a 50% progress
  console.log("Verifying progress in Library...");
  await expect(page.getByTestId("library-view")).toBeVisible();

  const verifyCard = page.locator("[data-testid^='book-card-']").first();
  const progressContainer = verifyCard.locator("[data-testid='progress-container']");
  await expect(progressContainer).toBeVisible();
  await expect(progressContainer).toHaveAttribute("aria-label", "Reading progress: 50%");
  await expect(progressContainer).toHaveAttribute("aria-valuenow", "50");

  await captureScreenshot(page, "reading_list_csv_success");
  console.log("Reading List CSV Journey Passed!");

  // Cleanup
  if (fs.existsSync(downloadPath)) {
    fs.unlinkSync(downloadPath);
  }
  if (fs.existsSync(modifiedPath)) {
    fs.unlinkSync(modifiedPath);
  }
});
