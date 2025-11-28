import asyncio
import re
from playwright.async_api import async_playwright, expect
import utils

async def run_test():
    async with async_playwright() as p:
        browser, context, page = await utils.setup(p)

        print("Starting Settings Journey...")
        await utils.reset_app(page)
        await utils.ensure_library_with_book(page)

        # Open Book
        await page.get_by_text("Alice's Adventures in Wonderland").click()
        await expect(page.get_by_label("Back")).to_be_visible()
        # Wait for book to load
        await page.wait_for_timeout(3000)

        # Navigate to a page with text (Chapter 1)
        print("Navigating to Chapter 1...")
        next_btn = page.get_by_label("Next Page")
        # Click a few times to get past cover/intro
        for _ in range(3):
            await next_btn.click()
            await page.wait_for_timeout(1000)

        # Verify we have some text content
        # frame = page.frame_locator("iframe[title='epubjs-iframe']")
        # await expect(frame.get_by_text("Alice")).to_be_visible() # Optional check

        # 1. Open Settings
        print("Opening Settings...")
        settings_btn = page.get_by_label("Settings")
        await settings_btn.click()
        await expect(page.get_by_text("Reader Settings")).to_be_visible()
        await utils.capture_screenshot(page, "settings_1_open")

        # 2. Select Custom Theme
        print("Selecting Custom Theme...")
        custom_theme_btn = page.get_by_label("Select custom theme")
        await custom_theme_btn.click()

        # Verify color pickers appear
        await expect(page.get_by_text("Background")).to_be_visible()
        await expect(page.get_by_text("Text")).to_be_visible()
        await utils.capture_screenshot(page, "settings_2_custom_selected")

        # 3. Change Font Family
        print("Changing Font Family...")
        font_select = page.locator("select").nth(0)
        await font_select.select_option("Consolas, Monaco, monospace")

        await utils.capture_screenshot(page, "settings_3_monospace")

        # 4. Change Line Height
        print("Changing Line Height...")
        # Locator for line height slider (second range input)
        await page.locator("input[type='range']").nth(1).fill("2")
        await utils.capture_screenshot(page, "settings_4_line_height")

        # 5. Persistence
        print("Reloading to check persistence...")
        await page.reload()
        await expect(page.get_by_label("Back")).to_be_visible(timeout=15000)
        await page.wait_for_timeout(3000)

        # Open settings again
        await settings_btn.click()

        # Verify custom theme is selected
        await expect(page.get_by_text("Background")).to_be_visible()

        # Verify font family value
        font_select = page.locator("select").nth(0)
        value = await font_select.input_value()
        if "monospace" not in value:
             raise Exception(f"Persistence failed: Font family is {value}")

        print("Settings Journey Passed!")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run_test())
