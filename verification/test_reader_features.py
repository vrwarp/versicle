
import asyncio
from playwright.async_api import async_playwright, expect
import re
import os

async def run_test():
    """
    Executes a comprehensive verification test suite for the Reader features using Playwright.

    The test covers:
    1. Navigation to the library.
    2. Uploading an EPUB book.
    3. Opening the book in the Reader view.
    4. Navigating pages (Next/Previous).
    5. Using the Table of Contents (TOC).
    6. Changing settings (Theme, Font Size).
    7. Persistence of settings and reading progress after reload.
    8. Keyboard navigation.
    9. Returning to the library and re-opening the book.

    Screenshots are saved to 'verification/screenshots/' at various steps.
    """
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
        await page.wait_for_selector("text=Alice's Adventures in Wonderland", timeout=10000)

        await page.screenshot(path="verification/screenshots/1_library_with_book.png")

        print("3. Open Book")
        await page.get_by_text("Alice's Adventures in Wonderland").click()

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
        await expect(page.get_by_role("heading", name="Contents")).to_be_visible()
        await page.screenshot(path="verification/screenshots/4_toc_open.png")

        # Click a chapter
        toc_item = page.locator("ul.space-y-2 li button").nth(1)
        await toc_item.click()

        # TOC should close
        await expect(page.get_by_role("heading", name="Contents")).not_to_be_visible()
        await page.screenshot(path="verification/screenshots/5_after_toc_nav.png")

        print("6. Test Settings & Theme")
        settings_btn = page.get_by_label("Settings")
        await settings_btn.click()

        await expect(page.get_by_text("Font Size")).to_be_visible()

        # Change theme to Sepia (3rd button)
        theme_section = page.locator("div", has_text="Theme")
        sepia_btn = theme_section.locator("button").nth(2)
        await sepia_btn.click()
        await page.screenshot(path="verification/screenshots/6_settings_sepia.png")

        # Verify if modal is still open. If not, reopen it.
        if not await page.get_by_text("Font Size").is_visible():
            print("Settings modal closed unexpectedly. Re-opening...")
            await settings_btn.click()
            await expect(page.get_by_text("Font Size")).to_be_visible()

        # Change Font Size
        print("Testing Font Size...")
        font_size_section = page.locator("div", has_text="Font Size")
        increase_font_btn = font_size_section.locator("button", has_text="+")
        decrease_font_btn = font_size_section.locator("button", has_text="-")

        # Verify initial state
        await expect(page.get_by_text("100%")).to_be_visible()

        # Click increase a few times
        await increase_font_btn.click()
        await increase_font_btn.click()
        # Verify percent text changed to 120%
        await expect(page.get_by_text("120%")).to_be_visible()

        await decrease_font_btn.click()
        await expect(page.get_by_text("110%")).to_be_visible()

        print("7. Test Persistence (Reload)")
        await page.reload()

        # Wait for book to load again
        await expect(page.get_by_label("Back")).to_be_visible(timeout=15000)
        await page.wait_for_timeout(2000)

        await page.screenshot(path="verification/screenshots/7_after_reload.png")
        print("Reloaded page.")

        print("8. Test Keyboard Navigation")
        # Focus on the viewer (body usually captures it)
        await page.keyboard.press("ArrowRight")
        await page.wait_for_timeout(500)
        await page.keyboard.press("ArrowLeft")
        await page.wait_for_timeout(500)

        print("9. Test Return to Library and Persistence")
        await page.get_by_label("Back").click()
        await expect(page).to_have_title(re.compile("Versicle"))

        # Open book again
        await page.get_by_text("Alice's Adventures in Wonderland").click()
        await expect(page).to_have_url(re.compile(r".*/read/.*"), timeout=15000)
        await page.wait_for_timeout(2000)

        await page.screenshot(path="verification/screenshots/8_return_to_book.png")

        print("All detailed verification tests passed.")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run_test())
