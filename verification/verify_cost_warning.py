
import asyncio
from playwright.async_api import async_playwright, expect

async def verify_cost_warning():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--disable-web-security", "--disable-features=IsolateOrigins,site-per-process"]
        )
        context = await browser.new_context()
        page = await context.new_page()

        await page.goto("http://localhost:5173")

        # Take screenshot of library to see what's happening
        await page.screenshot(path="verification/library_debug.png")

        try:
            file_input = await page.wait_for_selector('input[type="file"]', timeout=5000)
            await file_input.set_input_files("src/test/fixtures/alice.epub")

            # Use a more generic selector for the book card if the specific class one fails
            # Usually books are in a grid.
            # Let's wait for text "Alice's Adventures in Wonderland"
            await page.wait_for_selector('text=Alice', timeout=10000)
            await page.click('text=Alice')
        except Exception as e:
            print(f"Error during library interaction: {e}")
            await page.screenshot(path="verification/error_library.png")
            await browser.close()
            return

        try:
            await page.wait_for_url("**/read/*")
            await page.wait_for_timeout(3000)

            await page.click('button[aria-label="Text to Speech"]')
            await page.click('button[aria-label="Voice Settings"]')

            select = page.locator('select').filter(has=page.locator('option[value="google"]'))
            await select.select_option("google")

            await page.click('button:has-text("Back")')

            await page.click('button[aria-label="Play"]')

            try:
                await expect(page.get_by_text("Large Synthesis Warning")).to_be_visible(timeout=5000)
                print("Warning dialog appeared!")
            except AssertionError:
                print("Warning dialog did NOT appear.")

            await page.screenshot(path="verification/cost_warning_dialog.png")

        except Exception as e:
            print(f"Error during reader interaction: {e}")
            await page.screenshot(path="verification/error_reader.png")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify_cost_warning())
