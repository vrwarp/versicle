import asyncio
import re
from playwright.async_api import async_playwright, expect
import utils

async def run_test():
    async with async_playwright() as p:
        browser, context, page = await utils.setup(p)

        print("Starting Theme Verification...")
        await utils.reset_app(page)

        # 1. Setup - Upload Book
        print("Uploading book...")
        file_input = page.locator("input[type='file']")
        await file_input.set_input_files("src/test/fixtures/alice.epub")
        await expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible(timeout=10000)

        # 2. Verify Light Theme (Default)
        # Check background color of the body or main container.
        # body background-color should be #ffffff (var(--background))
        # We can check the class on html
        html = page.locator("html")
        # In this implementation, light theme is default and might have 'light' class or no class.
        # My ThemeSynchronizer adds 'light' explicitly.
        await expect(html).to_have_class(re.compile(r"\blight\b"))

        # Take screenshot
        await utils.capture_screenshot(page, "theme_1_library_light")

        # 3. Verify Dark Theme
        # We need to set the theme. Since there's no UI toggle in Library yet (it's in Reader Settings),
        # we will manually set localStorage and reload.
        print("Switching to Dark Theme via localStorage...")

        # Need to structure it exactly as zustand persist expects
        dark_state = {
            "state": {
                "currentTheme": "dark",
                "customTheme": {"bg": "#ffffff", "fg": "#000000"},
                "fontFamily": "serif",
                "lineHeight": 1.5,
                "fontSize": 100,
                "toc": [],
                "isLoading": False,
                "currentBookId": None,
                "currentCfi": None,
                "currentChapterTitle": None,
                "progress": 0
            },
            "version": 0
        }

        await page.evaluate(f"localStorage.setItem('reader-storage', '{str(dark_state).replace('False', 'false').replace('None', 'null').replace('\'', '\"')}')")
        await page.reload()

        # Verify Dark Class
        await expect(html).to_have_class(re.compile(r"\bdark\b"))

        # Verify visual change
        await utils.capture_screenshot(page, "theme_2_library_dark")

        # 4. Verify Sepia Theme
        print("Switching to Sepia Theme via localStorage...")
        sepia_state = str(dark_state).replace("dark", "sepia").replace('False', 'false').replace('None', 'null').replace('\'', '\"')
        await page.evaluate(f"localStorage.setItem('reader-storage', '{sepia_state}')")
        await page.reload()

        # Verify Sepia Class
        await expect(html).to_have_class(re.compile(r"\bsepia\b"))

        # Verify visual change
        await utils.capture_screenshot(page, "theme_3_library_sepia")

        print("Theme Verification Passed!")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run_test())
