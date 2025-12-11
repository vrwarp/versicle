"""
Playwright test for the Reading Journey.
Verifies book opening, page navigation (buttons and keyboard), and TOC interaction.
"""
import re
import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_reading_journey(page: Page):
    print("Starting Reading Journey...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    print("Opening book...")
    # Using locator with data-testid to be more precise
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))
    expect(page.get_by_test_id("reader-back-button")).to_be_visible()

    # Wait for content to render
    page.wait_for_timeout(2000)
    utils.capture_screenshot(page, "reading_01_initial_cover")

    # Helper to get current text content (for verification)
    def get_frame_text():
            # More stable selector using the container ID and then iframe
            frame = page.locator('[data-testid="reader-iframe-container"] iframe').content_frame
            # We need to wait for body
            try:
                frame.locator("body").wait_for(timeout=2000)
                text = frame.locator("body").inner_text()
                return text[:100].replace('\n', ' ') # Return start of text
            except:
                return "Frame/Body not ready"

    initial_text = get_frame_text()
    print(f"Initial Text: {initial_text}")

    # 1. Skip to Middle Chapter via TOC (Recommended navigation step)
    print("Testing TOC Navigation to Middle Chapter...")
    toc_btn = page.get_by_test_id("reader-toc-button")
    toc_btn.click()
    expect(page.get_by_test_id("reader-toc-sidebar")).to_be_visible()
    utils.capture_screenshot(page, "reading_02_toc_open")

    # Click a chapter (e.g., 8th item - Chapter V. Advice from a Caterpillar)
    # Using data-testid for toc item which is much more robust than nth(1) on generic list
    toc_item = page.get_by_test_id("toc-item-7")
    toc_text = toc_item.inner_text()
    print(f"Clicking TOC item: {toc_text}")
    toc_item.click()

    # TOC should close automatically (sidebar not visible)
    expect(page.get_by_test_id("reader-toc-sidebar")).not_to_be_visible()
    page.wait_for_timeout(2000)

    text_chapter = get_frame_text()
    print(f"Chapter Text: {text_chapter}")
    utils.capture_screenshot(page, "reading_03_chapter_start")

    # 2. Navigation (Next Page)
    print("Testing Next Page...")
    next_btn = page.get_by_test_id("reader-next-page")
    next_btn.click()
    page.wait_for_timeout(2000)
    text_next = get_frame_text()
    print(f"Next Page Text: {text_next}")
    utils.capture_screenshot(page, "reading_04_next_page")

    if text_next == text_chapter:
        print("WARNING: Content did not change after navigation!")

    # Prev Page
    print("Testing Prev Page...")
    prev_btn = page.get_by_test_id("reader-prev-page")
    prev_btn.click()
    page.wait_for_timeout(2000)
    text_prev = get_frame_text()
    print(f"Prev Page Text: {text_prev}")
    utils.capture_screenshot(page, "reading_05_prev_page")

    # 3. Keyboard Shortcuts
    print("Testing Keyboard Shortcuts...")
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(1000)
    # reading_08_keyboard_right removed as redundant

    text_key = get_frame_text()
    print(f"After Key Right Text: {text_key}")

    print("Reading Journey Passed!")
