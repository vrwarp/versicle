
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

        # 1. Go to library
        await page.goto("http://localhost:5173")
        await expect(page).to_have_title(re.compile("Versicle"))

        # 2. Upload book
        file_input = page.locator("input[type='file']")
        await file_input.set_input_files("src/test/fixtures/alice.epub")
        await page.wait_for_selector("text=Alice's Adventures in Wonderland", timeout=10000)

        await page.screenshot(path="verification/screenshots/1_library_with_book.png")

        # 3. Open Book
        print("Opening book...")
        await page.get_by_text("Alice's Adventures in Wonderland").click()

        # Wait for Reader View
        await expect(page).to_have_url(re.compile(r".*/read/.*"), timeout=15000)
        await expect(page.get_by_label("Back")).to_be_visible(timeout=15000)

        # Wait for rendering
        await page.wait_for_timeout(2000)
        await page.screenshot(path="verification/screenshots/2_reader_view.png")

        # 4. Test Navigation (Next Page)
        print("Testing Navigation...")
        next_btn = page.get_by_label("Next Page")
        await next_btn.click()
        await page.wait_for_timeout(1000)
        await page.screenshot(path="verification/screenshots/3_next_page.png")

        # 5. Test TOC
        print("Testing TOC...")
        toc_btn = page.get_by_label("Table of Contents")
        await toc_btn.click()
        await expect(page.get_by_role("heading", name="Contents")).to_be_visible()
        await page.screenshot(path="verification/screenshots/4_toc_open.png")

        # Click a chapter (pick the second one to avoid clicking "Contents" again if it is listed)
        # Or just the first button in the list
        toc_item = page.locator("ul.space-y-2 li button").first
        await toc_item.click()

        # TOC should close
        await expect(page.get_by_role("heading", name="Contents")).not_to_be_visible()
        await page.screenshot(path="verification/screenshots/5_after_toc_nav.png")

        # 6. Test Settings
        print("Testing Settings...")
        settings_btn = page.get_by_label("Settings")
        await settings_btn.click()
        await expect(page.get_by_text("Font Size")).to_be_visible()

        # Change theme to Sepia (3rd button)
        theme_btns = page.locator("button.rounded-full.border")
        # Buttons are: Back, TOC, Settings (in header), and then in modal: light, dark, sepia
        # We need to be careful with locator.
        # The modal buttons are inside the absolute div.
        # Let's target by style or finding the container.

        # Better: locator for theme buttons inside the settings modal
        # We can find the container with "Theme" label
        theme_section = page.locator("div", has_text="Theme")
        sepia_btn = theme_section.locator("button").nth(2)
        await sepia_btn.click()

        await page.screenshot(path="verification/screenshots/6_settings_sepia.png")

        print("All visual verification tests passed.")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run_test())
