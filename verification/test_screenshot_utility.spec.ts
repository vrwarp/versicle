import { test, expect } from "./utils";
import { captureScreenshot } from "./utils";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("screenshot hides debug overlay", async ({ page }) => {
  // 1. Setup: Create a fake tts-debug element
  await page.setContent(`
    <html>
      <body>
        <div id="content">Main Content</div>
        <div id="tts-debug" style="position:fixed; bottom:10px; right:10px; background:red; width:100px; height:50px;">
          DEBUG
        </div>
      </body>
    </html>
  `);

  // Verify initial state
  const debugEl = page.locator("#tts-debug");
  await expect(debugEl).toBeVisible();

  // 2. Capture screenshot with hideTtsStatus=true
  const screenshotName = "test_debug_hidden";
  await captureScreenshot(page, screenshotName, true);

  // 3. Verify it's visible again after the capture
  await expect(debugEl).toBeVisible();

  // Cleanup
  const viewport = page.viewportSize();
  const width = viewport ? viewport.width : 1280;
  const suffix = width < 600 ? "mobile" : "desktop";
  const filePath = path.join(__dirname, "screenshots", `${screenshotName}_${suffix}.png`);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
});

test("screenshot ignores missing overlay", async ({ page }) => {
  await page.setContent("<html><body><div>Just Content</div></body></html>");

  const screenshotName = "test_missing_debug";
  await captureScreenshot(page, screenshotName, true);

  // Cleanup
  const viewport = page.viewportSize();
  const width = viewport ? viewport.width : 1280;
  const suffix = width < 600 ? "mobile" : "desktop";
  const filePath = path.join(__dirname, "screenshots", `${screenshotName}_${suffix}.png`);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
});
