import pytest
import os
from playwright.sync_api import Page, expect
from verification import utils

def test_journey_view_mode(page: Page):
    """
    Test the user journey for toggling between Paginated and Scrolled view modes.
    Verifies that the setting is applied and persisted.
    """
    print("Starting View Mode Journey...")
    # 1. Load the app and reset state
    utils.reset_app(page)

    # 2. Upload a book
    file_path = "src/test/fixtures/alice.epub"
    if not os.path.exists(file_path):
        # Fallback if running in a different context
        file_path = "verification/alice.epub"
        if not os.path.exists(file_path):
             pytest.skip("alice.epub fixture not found")

    # Upload
    page.locator('input[type="file"]').set_input_files(file_path)

    # 3. Open the book
    # Wait for book card and click
    page.locator('[data-testid="book-card"]').click()

    # Wait for reader iframe to ensure book is loaded
    expect(page.locator('[data-testid="reader-iframe-container"]')).to_be_visible(timeout=10000)

    # 4. Navigate to Chapter 5 (Advice from a Caterpillar)
    # Open TOC
    page.locator('[data-testid="reader-toc-button"]').click()

    # Wait for TOC to appear
    expect(page.locator('[data-testid="reader-toc-sidebar"]')).to_be_visible()

    # Click on Chapter 5
    # Alice in Wonderland chapters: 1. Down the Rabbit-Hole ... 5. Advice from a Caterpillar
    # We can assume item index 5 or 4 depending on frontmatter. Let's find by text if possible, or assume index.
    # alice.epub usually has chapters labeled properly.

    # Try to find text "Advice from a Caterpillar" or similar
    chapter_link = page.get_by_text("Advice from a Caterpillar")
    if chapter_link.count() > 0:
        chapter_link.click()
    else:
        # Fallback to index 5 (0-based, so 6th item, likely Chapter 5 if counting cover/toc)
        print("Chapter title not found, clicking 6th item")
        page.locator('[data-testid="toc-item-5"]').click()

    # Wait for navigation (TOC closes automatically or we assume we are there)
    # TOC sidebar might stay open depending on implementation?
    # ReaderView: `onClick={() => { ... setShowToc(false); }}` -> It closes.

    # Wait for content to load/render
    page.wait_for_timeout(1000)

    # 5. Open Settings
    page.locator('[data-testid="reader-settings-button"]').click()

    # 6. Verify Default State (Paginated)
    paginated_btn = page.locator('[data-testid="settings-layout-paginated"]')
    scrolled_btn = page.locator('[data-testid="settings-layout-scrolled"]')

    expect(paginated_btn).to_be_visible()
    expect(scrolled_btn).to_be_visible()

    utils.capture_screenshot(page, "view_mode_1_settings_default_chap5")

    # 7. Switch to Scrolled Mode
    scrolled_btn.click()

    # Verify persistence in localStorage
    storage = page.evaluate("localStorage.getItem('reader-storage')")
    assert '"viewMode":"scrolled"' in storage

    # Close settings to see the view
    page.locator('[data-testid="settings-close-button"]').click()

    # Wait a moment for layout to settle (epub.js might need time to reflow)
    page.wait_for_timeout(1000)

    utils.capture_screenshot(page, "view_mode_2_scrolled_view_chap5")

    # Re-open settings to verify state UI
    page.locator('[data-testid="reader-settings-button"]').click()
    utils.capture_screenshot(page, "view_mode_3_settings_scrolled_active_chap5")

    # 8. Switch back to Paginated Mode
    paginated_btn.click()

    storage_after = page.evaluate("localStorage.getItem('reader-storage')")
    assert '"viewMode":"paginated"' in storage_after

    print("View Mode Journey Passed!")
