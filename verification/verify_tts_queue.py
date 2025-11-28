
import asyncio
from playwright.async_api import async_playwright, expect
from utils import ensure_library_with_book

async def verify_tts_queue():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        try:
            # 1. Navigate to home (Library)
            await page.goto("http://localhost:5173")

            # 2. Ensure book is present
            await ensure_library_with_book(page)

            # 3. Click on the book to open Reader
            await page.click("text=Alice's Adventures in Wonderland")

            # 4. Wait for Reader to load (wait for Next Page button)
            await expect(page.locator("button[aria-label='Next Page']")).to_be_visible(timeout=15000)

            # 5. Navigate to Chapter 1 (Cover usually has no text)
            # Click Next Page a few times to get to text
            for _ in range(2):
                await page.click("button[aria-label='Next Page']")
                await page.wait_for_timeout(1000) # Wait for render

            # Wait for some text to ensure extraction happened
            # "Down the Rabbit-Hole" is usually Chapter 1
            # But let's just wait for ANY text.
            # We can check if "Playback Queue" populates.

            # 6. Open TTS Controls
            await page.click("button[aria-label='Text to Speech']")

            # 7. Verify TTS Queue is visible
            await expect(page.get_by_text("Playback Queue")).to_be_visible()

            # 8. Take screenshot of Queue
            await page.screenshot(path="verification/verify_tts_queue.png")
            print("Screenshot taken: verification/verify_tts_queue.png")

            # 9. Verify Empty State OR Content
            # If we are on a text page, we expect content.
            # If extraction failed, we might see "No text to play".
            # Let's see what we got.

            # Check if empty state is visible
            empty_state = await page.locator("text=No text to play").is_visible()
            if empty_state:
                print("Empty State Verified (or unexpected if text should be there)")
            else:
                print("Queue populated")
                # Verify first item
                # items are buttons in the queue
                items = page.locator("button.w-full.text-left")
                count = await items.count()
                print(f"Found {count} queue items")
                if count > 0:
                    print("Queue Content Verified")

        except Exception as e:
            print(f"Error: {e}")
            await page.screenshot(path="verification/error_verify_tts_queue.png")
            raise e
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(verify_tts_queue())
