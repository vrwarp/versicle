import { test, expect } from './utils';
import * as utils from './utils';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
async function uploadBook(page: any, filename: string) {
  console.log(`Uploading ${filename}...`);
  const filePath = path.resolve(__dirname, filename);
  const fileBuffer = fs.readFileSync(filePath);
  const fileBase64 = fileBuffer.toString('base64');

  await page.evaluate(({ base64Data, filename }) => {
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const file = new File([byteArray], filename, { type: 'application/epub+zip' });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    const dropEvent = new DragEvent('drop', { dataTransfer: dataTransfer, bubbles: true });
    document.querySelector('[data-testid="library-view"]')!.dispatchEvent(dropEvent);
  }, { base64Data: fileBase64, filename });

  await page.waitForTimeout(2000);
}

test('Chinese Book Journey', async ({ page }) => {
  console.log('Starting Chinese Book Journey...');
  await utils.resetApp(page);

  // 1. Upload Chinese book
  await uploadBook(page, 'test_chinese.epub');

  // Wait for book card to appear
  const bookCard = page.locator("[data-testid^='book-card-']", { hasText: 'Test Chinese Book' }).first();
  await expect(bookCard).toBeVisible({ timeout: 15000 });

  // 2. Open Book
  console.log('Opening book...');
  await bookCard.click();
  await expect(page.getByTestId('reader-view')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(2000);

  // Ensure text is rendered in iframe
  const frameLoc = utils.getReaderFrame(page);
  if (frameLoc) {
    await expect(frameLoc.locator('body')).toContainText('测试用的中文书');
  }

  // 3. Open Visual Settings and toggle options
  console.log('Opening Visual Settings...');
  await page.getByTestId('reader-visual-settings-button').click();

  // Ensure book language is set to 'zh' if it's not detected properly
  const langSelect = page.getByTestId('book-language-select');
  await expect(langSelect).toBeVisible({ timeout: 5000 });
  if ((await langSelect.innerText()).includes('en')) {
    await langSelect.click();
    await page.getByRole('option', { name: 'Chinese (zh)' }).click();
    await page.waitForTimeout(1000);
  }

  // Verify Pinyin toggle
  const pinyinSwitch = page.getByTestId('show-pinyin-switch');
  await expect(pinyinSwitch).toBeVisible();
  await pinyinSwitch.click();
  await utils.captureScreenshot(page, 'chinese_journey_01_pinyin');

  // Verify Traditional Chinese toggle
  const tradSwitch = page.getByTestId('force-traditional-switch');
  await expect(tradSwitch).toBeVisible();
  await tradSwitch.click();
  await utils.captureScreenshot(page, 'chinese_journey_02_traditional');

  // Wait for re-render inside iframe
  await page.waitForTimeout(2000);

  // 4. Global TTS Settings
  console.log('Checking Global Settings > TTS...');
  // Close visual settings popover by clicking outside
  await page.mouse.click(10, 10);
  await page.waitForTimeout(500);

  await page.locator('body').click({ position: { x: 100, y: 100 } });
  await page.waitForTimeout(500);

  // Back to library
  const backBtn = page.getByTestId('reader-back-button');
  if (!(await backBtn.isVisible())) {
    await page.locator('body').click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(500);
  }
  if (await backBtn.isVisible()) {
    await backBtn.click();
    await page.waitForTimeout(1000);
  }

  await page.getByTestId('header-settings-button').click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.getByRole('button', { name: 'TTS Engine', exact: true }).click();

  // Wait for TTS Settings Tab to load
  await expect(page.getByText('Language Profile')).toBeVisible();

  const languageSelect = page.getByTestId('tts-language-select');
  await expect(languageSelect).toBeVisible({ timeout: 5000 });

  const currentLang = await languageSelect.innerText();
  if (currentLang.includes('English')) {
    await languageSelect.click();
    await page.getByRole('option', { name: 'Chinese' }).click();
    await page.waitForTimeout(1000);
  }

  await expect(languageSelect).toContainText('Chinese', { ignoreCase: true, timeout: 5000 });

  await page.waitForTimeout(1000);
  const warningLocator = page.getByTestId('mandarin-voice-warning');
  if ((await warningLocator.count()) > 0) {
    await expect(warningLocator).toBeVisible();
  }

  await utils.captureScreenshot(page, 'chinese_journey_03_tts_settings');
  console.log('Chinese Book Journey Passed!');
});

test('Journey Smart Pinyin', async ({ page }) => {
  console.log('Starting Adaptive Smart Pinyin Journey...');
  await utils.resetApp(page);

  // 1. Upload Chinese book
  await uploadBook(page, 'test_chinese.epub');

  // Wait for book card to appear
  const bookCard = page.locator("[data-testid^='book-card-']", { hasText: 'Test Chinese Book' }).first();
  await expect(bookCard).toBeVisible({ timeout: 15000 });

  // 2. Open Book
  console.log('Opening book...');
  await bookCard.click();
  await expect(page.getByTestId('reader-view')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(2000);

  // Ensure text is rendered in iframe
  const frame = page.locator('[data-testid="reader-iframe-container"] iframe').contentFrame();
  await frame.locator('body').waitFor({ timeout: 5000 });
  await expect(frame.locator('body')).toContainText('测试用的中文书', { timeout: 10000 });

  // 3. Open Visual Settings, ensure language is Chinese, and turn on Pinyin
  console.log('Enabling Pinyin overlay...');
  await page.getByTestId('reader-visual-settings-button').click();

  // Ensure book language is set to 'zh' if not detected
  const langSelect = page.getByTestId('book-language-select');
  await expect(langSelect).toBeVisible({ timeout: 5000 });
  if ((await langSelect.innerText()).includes('en')) {
    await langSelect.click();
    await page.getByRole('option', { name: 'Chinese (zh)' }).click();
    await page.waitForTimeout(1000);
  }

  const pinyinSwitch = page.getByTestId('show-pinyin-switch');
  await expect(pinyinSwitch).toBeVisible();

  // Ensure Pinyin switch is toggled active
  if ((await pinyinSwitch.getAttribute('data-state')) !== 'checked') {
    await pinyinSwitch.click();
  }

  // Close popover by clicking outside
  await page.mouse.click(10, 10);
  await page.waitForTimeout(1000);

  // 4. Trigger text selection of Chinese characters inside the iframe
  console.log('Selecting Chinese text...');
  await frame.locator('body').evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();
    while (node) {
      if (node.textContent && node.textContent.includes('测试用的中文书')) {
        const range = document.createRange();
        const startIdx = node.textContent.indexOf('测试');
        range.setStart(node, startIdx);
        range.setEnd(node, startIdx + 7); // Select "测试用的中文书"
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);

          // Dispatch mouseup to trigger selection popover
          document.dispatchEvent(
            new MouseEvent('mouseup', {
              view: window,
              bubbles: true,
              cancelable: true,
              clientX: 100,
              clientY: 100
            })
          );
        }
        break;
      }
      node = walker.nextNode();
    }
  });

  // 5. Expect Selection Toolbar to appear with "Mark as Known" button
  console.log('Verifying Selection Toolbar...');
  await expect(page.getByTestId('compass-pill-annotation')).toBeVisible({ timeout: 5000 });

  const vocabBtn = page.getByTestId('popover-vocab-button');
  await expect(vocabBtn).toBeVisible();
  await utils.captureScreenshot(page, 'smart_pinyin_01_toolbar');

  // 6. Open Precision Triage interface
  console.log('Opening Precision Vocab Triage...');
  await vocabBtn.click();

  // Expect Vocab Triage card to render
  await expect(page.getByTestId('compass-pill-vocab-triage')).toBeVisible({ timeout: 5000 });
  await utils.captureScreenshot(page, 'smart_pinyin_02_triage');

  // 7. Click a character tile (e.g. "中") to toggle proficiency
  console.log("Toggling known character '中'...");
  const tileBtn = page.locator("button:has-text('中')").first();
  await expect(tileBtn).toBeVisible();

  // Toggle it
  await tileBtn.click();
  await page.waitForTimeout(500);
  await utils.captureScreenshot(page, 'smart_pinyin_03_toggled');

  // 8. Complete triage
  console.log('Completing triage...');
  const doneBtn = page.getByRole('button', { name: 'Done' });
  await expect(doneBtn).toBeVisible();
  await doneBtn.click();
  await page.waitForTimeout(1000);

  // Triage and popover should close cleanly
  await expect(page.getByTestId('compass-pill-vocab-triage')).not.toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('compass-pill-annotation')).not.toBeVisible({ timeout: 5000 });

  console.log('Adaptive Smart Pinyin Journey Passed!');
});
