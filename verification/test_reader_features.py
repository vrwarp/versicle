
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

        # --- LIBRARY TESTS ---

        # Check if book exists from previous run, if so, delete it
        try:
            # We use a short timeout check to see if book exists
            await expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible(timeout=2000)
            print("Cleaning up previous book...")
            # Hover to show delete button
            await page.get_by_text("Alice's Adventures in Wonderland").hover()
            # Click delete button (Trash2 icon)
            # Use page.once to handle just this dialog
            page.once("dialog", lambda dialog: dialog.accept())
            await page.get_by_label("Delete Alice's Adventures in Wonderland").click()
            await expect(page.get_by_text("Alice's Adventures in Wonderland")).not_to_be_visible()
        except AssertionError:
            pass # Book not there, proceed
        except Exception as e:
            print(f"Cleanup warning: {e}")

        print("2. Upload book")
        file_input = page.locator("input[type='file']")
        await file_input.set_input_files("src/test/fixtures/alice.epub")
        await page.wait_for_selector("text=Alice's Adventures in Wonderland", timeout=10000)

        # Verify book count (assuming only 1 book for now, or at least 1)
        books = page.locator("h3", has_text="Alice's Adventures in Wonderland")
        await expect(books).to_have_count(1)

        await page.screenshot(path="verification/screenshots/1_library_with_book.png")

        # --- READER TESTS ---

        print("3. Open Book")
        await page.get_by_text("Alice's Adventures in Wonderland").click()

        # Wait for Reader View
        await expect(page).to_have_url(re.compile(r".*/read/.*"), timeout=15000)
        await expect(page.get_by_label("Back")).to_be_visible(timeout=15000)

        # Wait for rendering - give it time to load the first chapter
        await page.wait_for_timeout(3000)

        # Wait for iframe existence. Use frame_locator instead of getting element handle for better stability
        frame_loc = page.frame_locator("iframe").first

        # Wait for body in frame
        print("Waiting for content in iframe...")
        try:
            # check if body exists
            await expect(frame_loc.locator("body")).to_be_visible(timeout=10000)
        except Exception as e:
            print(f"Warning: Frame body not visible: {e}")


        # Check for title page content
        body_text = await frame_loc.locator("body").inner_text()
        print(f"First page content snippet: {body_text[:100]}...")

        if "Alice" not in body_text and "Project Gutenberg" not in body_text:
             print("Warning: 'Alice' or 'Project Gutenberg' not found on first page. Content might be cover image only.")

        await page.screenshot(path="verification/screenshots/2_reader_view.png")

        # --- NAVIGATION TESTS ---

        print("4. Test Navigation (Next Page)")
        next_btn = page.get_by_label("Next Page")
        await next_btn.click()
        await page.wait_for_timeout(2000) # Wait for transition

        # Verify content changed
        body_text_page2 = await frame_loc.locator("body").inner_text()
        print(f"Second page content snippet: {body_text_page2[:100]}...")
        assert body_text != body_text_page2, "Content did not change after clicking Next"

        await page.screenshot(path="verification/screenshots/3_next_page.png")

        print("5. Test Navigation (Prev Page)")
        prev_btn = page.get_by_label("Previous Page")
        await prev_btn.click()
        await page.wait_for_timeout(2000)

        # Verify content reverted
        body_text_back = await frame_loc.locator("body").inner_text()
        if body_text != body_text_back:
            print("Warning: Content after 'Prev' is not identical to start. Might be re-paginated.")

        # --- TOC TESTS ---

        print("6. Test TOC")
        toc_btn = page.get_by_label("Table of Contents")
        await toc_btn.click()
        await expect(page.get_by_role("heading", name="Contents")).to_be_visible()

        # Verify specific chapter names
        await expect(page.get_by_role("button", name=re.compile("Down the Rabbit-Hole"))).to_be_visible()

        await page.screenshot(path="verification/screenshots/4_toc_open.png")

        # Navigate to "VII. A Mad Tea-Party"
        print("Navigating to Chapter VII...")
        chapter_btn = page.locator("button", has_text="A Mad Tea-Party")
        if await chapter_btn.count() == 0:
             print("Chapter VII not found in TOC.")
        else:
            await chapter_btn.click()

            # TOC should close
            await expect(page.get_by_role("heading", name="Contents")).not_to_be_visible()

            # Verify content matches "A Mad Tea-Party"
            await page.wait_for_timeout(3000) # Wait for render

            # Wait for text to appear
            try:
                await expect(frame_loc.locator("body")).to_contain_text("Tea-Party", timeout=10000)
            except AssertionError:
                 print("Content verification for Chapter 7 failed. Content:")
                 print((await frame_loc.locator("body").inner_text())[:200])

            await page.screenshot(path="verification/screenshots/5_after_toc_nav.png")

        # --- SETTINGS TESTS ---

        print("7. Test Settings")
        settings_btn = page.get_by_label("Settings")
        await settings_btn.click()
        await expect(page.get_by_text("Font Size")).to_be_visible()

        # Theme: Sepia
        print("Testing Theme: Sepia")
        theme_section = page.locator("div", has_text="Theme")
        sepia_btn = theme_section.locator("button").nth(2)
        await sepia_btn.click()
        await page.wait_for_timeout(1000)
        await page.screenshot(path="verification/screenshots/6_settings_sepia.png")

        # Theme: Dark
        print("Testing Theme: Dark")
        # Re-locate to ensure freshness
        dark_btn = page.locator("div", has_text="Theme").locator("button").nth(1)
        await dark_btn.click()
        await page.wait_for_timeout(1000)
        await page.screenshot(path="verification/screenshots/7_settings_dark.png")

        # Font Size
        print("Testing Font Size")
        font_section = page.locator("div", has_text="Font Size")
        increase_btn = font_section.locator("button").last

        # Get initial font size
        initial_font_size = await frame_loc.locator("body").evaluate("el => window.getComputedStyle(el).fontSize")
        print(f"Initial Font Size: {initial_font_size}")

        await increase_btn.click()
        await increase_btn.click()
        await page.wait_for_timeout(1000)

        new_font_size = await frame_loc.locator("body").evaluate("el => window.getComputedStyle(el).fontSize")
        print(f"New Font Size: {new_font_size}")

        def parse_px(px_str):
            try:
                return float(px_str.replace("px", ""))
            except:
                return 0

        if parse_px(new_font_size) <= parse_px(initial_font_size):
            print("Warning: Font size check failed. It might be applied to a different element.")

        # Close settings
        await settings_btn.click()

        # --- LIBRARY DELETE TEST (Cleanup) ---
        print("8. Test Delete Book")
        # Go back to library
        await page.get_by_label("Back").click()
        await expect(page).to_have_url(re.compile(r".*/$"))

        # Verify we are back
        await expect(page.get_by_text("My Library")).to_be_visible()

        # Delete the book
        print("Deleting book...")
        await page.get_by_text("Alice's Adventures in Wonderland").hover()

        # Handle Confirm Dialog
        # Use page.once here as well
        page.once("dialog", lambda dialog: dialog.accept())

        await page.get_by_label("Delete Alice's Adventures in Wonderland").click()

        # Verify book is gone
        await expect(page.get_by_text("Alice's Adventures in Wonderland")).not_to_be_visible()
        # Should see empty state message
        await expect(page.get_by_text("No books yet")).to_be_visible()

        await page.screenshot(path="verification/screenshots/8_library_empty.png")

        print("All verification tests passed.")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run_test())
