import asyncio
from playwright.async_api import async_playwright, expect
from utils import setup, reset_app, capture_screenshot

async def verify_tts_phase4():
    async with async_playwright() as p:
        # Use existing setup utility if possible or replicate
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        try:
            # Go to home
            await page.goto("http://localhost:5173/")

            # Reset app to ensure clean state
            await reset_app(page)
            await page.reload()

            # Since reset clears DB, we need to upload a book or ensure one is there.
            # But we can rely on `test_journey_library` to have put a book there if we didn't wipe indexeddb?
            # reset_app clears everything. So we must upload.

            # Upload book (assuming fixture exists)
            file_input = page.locator("input[type='file']")
            await file_input.set_input_files("src/test/fixtures/alice.epub")

            # Wait for book to appear
            await page.wait_for_selector("text=Alice's Adventures in Wonderland", timeout=10000)

            # Click on book to read
            await page.click("text=Alice's Adventures in Wonderland")

            # Wait for reader view
            await page.wait_for_selector("button[aria-label='Text to Speech']", timeout=10000)

            # Open TTS Controls
            await page.click("button[aria-label='Text to Speech']")

            # Check for Queue button
            queue_btn = page.locator("button[title='Queue']")
            await expect(queue_btn).to_be_visible()

            # Click Queue button
            await queue_btn.click()

            # Verify Queue UI is visible
            await expect(page.locator("text=Playback Queue")).to_be_visible()
            await expect(page.locator("text=Back to Controls")).to_be_visible()

            # Take screenshot of Queue
            await page.screenshot(path="verification/tts_queue.png")

            # Go back
            await page.click("text=Back to Controls")

            # Open Settings
            await page.click("button[title='Settings']")

            # Select Cloud Provider (Google)
            await page.select_option("select", "google")

            # Verify Cost Warning
            await expect(page.locator("text=Cost Warning:")).to_be_visible()

            # Take screenshot of Cost Warning
            await page.screenshot(path="verification/tts_cost_warning.png")

            print("Verification successful!")

        except Exception as e:
            print(f"Error: {e}")
            await page.screenshot(path="verification/error.png")
            raise e
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(verify_tts_phase4())
