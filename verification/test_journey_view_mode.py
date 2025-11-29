import pytest
import os
from playwright.sync_api import Page, expect

def test_journey_view_mode(page: Page):
    """
    Test the user journey for toggling between Paginated and Scrolled view modes.
    Verifies that the setting is applied and persisted.
    """
    # 1. Load the app and reset state
    page.goto("http://localhost:5173/")
    page.evaluate("localStorage.clear()")
    page.reload()

    # 2. Upload a book
    # Locate the alice.epub fixture
    file_path = "src/test/fixtures/alice.epub"
    if not os.path.exists(file_path):
        # Fallback if running in a different context, though strictly it should be there
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

    # 4. Open Settings
    page.locator('[data-testid="reader-settings-button"]').click()

    # 5. Verify Default State (Paginated)
    paginated_btn = page.locator('[data-testid="settings-layout-paginated"]')
    scrolled_btn = page.locator('[data-testid="settings-layout-scrolled"]')

    expect(paginated_btn).to_be_visible()
    expect(scrolled_btn).to_be_visible()

    # Check visual indication of active state (optional, but good)
    # The active button has blue text (text-blue-600)
    # expect(paginated_btn).to_have_class(re.compile(r"text-blue-600"))

    # 6. Switch to Scrolled Mode
    scrolled_btn.click()

    # Verify persistence in localStorage
    storage = page.evaluate("localStorage.getItem('reader-storage')")
    assert '"viewMode":"scrolled"' in storage

    # 7. Switch back to Paginated Mode
    paginated_btn.click()

    storage_after = page.evaluate("localStorage.getItem('reader-storage')")
    assert '"viewMode":"paginated"' in storage_after

    # Close settings
    page.locator('[data-testid="settings-close-button"]').click()
