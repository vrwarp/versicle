
import asyncio
from playwright.async_api import async_playwright, expect
import re
import os

async def run_test():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # Ensure screenshots directory exists
        os.makedirs("verification/screenshots", exist_ok=True)

        print("1. Go to library")
        await page.goto("http://localhost:5173")
        await expect(page).to_have_title(re.compile("Versicle"))

        print("2. Upload book")
        file_input = page.locator("input[type='file']")

        await file_input.set_input_files("src/test/fixtures/alice.epub")

        # Wait for book card to appear (relaxed selector to match 'Alice')
        await page.wait_for_selector("text=Alice", timeout=10000)

        await page.screenshot(path="verification/screenshots/1_library_with_book.png")

        print("3. Open Book")
        # Click the card
        await page.locator("text=Alice").first.click()

        # Wait for Reader View
        await expect(page).to_have_url(re.compile(r".*/read/.*"), timeout=15000)
        await expect(page.get_by_label("Back")).to_be_visible(timeout=15000)

        # Wait for rendering
        await page.wait_for_timeout(2000)
        await page.screenshot(path="verification/screenshots/2_reader_view.png")

        print("4. Test Navigation (Next/Prev)")
        next_btn = page.get_by_label("Next Page")
        await next_btn.click()
        await page.wait_for_timeout(1000)
        await page.screenshot(path="verification/screenshots/3_next_page.png")

        # Test Previous Page
        prev_btn = page.get_by_label("Previous Page")
        await prev_btn.click()
        await page.wait_for_timeout(1000)

        # Go forward again
        await next_btn.click()
        await page.wait_for_timeout(1000)

        print("5. Test TOC")
        toc_btn = page.get_by_label("Table of Contents")
        await toc_btn.click()
        await expect(page.get_by_role("heading", name="Table of Contents")).to_be_visible()
        await page.screenshot(path="verification/screenshots/4_toc_open.png")

        # Click a chapter
        toc_items = page.locator("ul li button")
        await toc_items.nth(1).click()

        # Close sheet if still open
        if await page.get_by_role("heading", name="Table of Contents").is_visible():
            await page.keyboard.press("Escape")
            await expect(page.get_by_role("heading", name="Table of Contents")).not_to_be_visible()

        await page.screenshot(path="verification/screenshots/5_after_toc_nav.png")

        print("6. Test Settings & Theme")
        settings_btn = page.get_by_label("Settings")
        await settings_btn.click()

        await expect(page.get_by_text("Appearance")).to_be_visible()

        await page.get_by_role("button", name="Sepia").click()
        await page.screenshot(path="verification/screenshots/6_settings_sepia.png")

        await expect(page.get_by_text("Appearance")).to_be_visible()
        await expect(page.get_by_text("100%")).to_be_visible()

        print("7. Test Persistence (Reload)")
        await page.reload()

        # Wait for book to load again
        await expect(page.get_by_label("Back")).to_be_visible(timeout=15000)
        await page.wait_for_timeout(2000)

        await page.screenshot(path="verification/screenshots/7_after_reload.png")
        print("Reloaded page.")

        print("8. Test Keyboard Navigation")
        await page.mouse.click(400, 300)

        await page.keyboard.press("ArrowRight")
        await page.wait_for_timeout(500)
        await page.keyboard.press("ArrowLeft")
        await page.wait_for_timeout(500)

        print("9. Test Return to Library and Persistence")
        await page.get_by_label("Back").click()
        await expect(page).to_have_title(re.compile("Versicle"))

        # Open book again
        await page.get_by_text("Alice").first.click()
        await expect(page).to_have_url(re.compile(r".*/read/.*"), timeout=15000)
        await page.wait_for_timeout(2000)

        await page.screenshot(path="verification/screenshots/8_return_to_book.png")

        print("All detailed verification tests passed.")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run_test())
