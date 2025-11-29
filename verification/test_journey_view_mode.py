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
    # Check for hidden file input (standard in LibraryView)
    # The new library might use the visible one or hidden one.
    # Previous tests used page.locator('input[type="file"]') or get_by_test_id("hidden-file-input")
    # Let's try the locator first as it is generic.
    page.locator('input[type="file"]').set_input_files(file_path)

    # 3. Open the book
    # Wait for book card and click
    page.locator('[data-testid="book-card"]').click()

    # Wait for reader iframe to ensure book is loaded
    expect(page.locator('[data-testid="reader-iframe-container"]')).to_be_visible(timeout=10000)

    # 4. Open Settings
    page.locator('[data-testid="reader-settings-button"]').click()

    # 5. Verify Default State (Paginated)
    paginated_btn = page.locator('[data-testid="settings-layout-paginated"]')
    scrolled_btn = page.locator('[data-testid="settings-layout-scrolled"]')

    expect(paginated_btn).to_be_visible()
    expect(scrolled_btn).to_be_visible()

    utils.capture_screenshot(page, "view_mode_1_settings_default")

    # 6. Switch to Scrolled Mode
    scrolled_btn.click()

    # Verify persistence in localStorage
    storage = page.evaluate("localStorage.getItem('reader-storage')")
    assert '"viewMode":"scrolled"' in storage

    # Close settings to see the view
    page.locator('[data-testid="settings-close-button"]').click()

    # Wait a moment for layout to settle (epub.js might need time to reflow)
    page.wait_for_timeout(1000)

    utils.capture_screenshot(page, "view_mode_2_scrolled_view")

    # Re-open settings to verify state UI
    page.locator('[data-testid="reader-settings-button"]').click()
    utils.capture_screenshot(page, "view_mode_3_settings_scrolled_active")

    # 7. Switch back to Paginated Mode
    paginated_btn.click()

    storage_after = page.evaluate("localStorage.getItem('reader-storage')")
    assert '"viewMode":"paginated"' in storage_after

    print("View Mode Journey Passed!")
