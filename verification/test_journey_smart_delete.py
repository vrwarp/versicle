import re
import pytest
import os
from playwright.sync_api import Page, expect
from verification.utils import reset_app, capture_screenshot

@pytest.fixture
def demo_epub_path():
    # Use the one in src/test/fixtures as that's what other tests use
    return os.path.abspath("src/test/fixtures/alice.epub")

def test_smart_delete_journey(page: Page, demo_epub_path):
    """
    Verifies the Smart Delete (Offload) and Restore functionality.
    1. Import a book.
    2. Offload the book (delete file).
    3. Verify UI reflects offloaded state.
    4. Attempt to open -> should trigger restore flow (mocked).
    5. Restore the book.
    6. Verify book opens correctly.
    """
    reset_app(page)

    # 1. Import Book
    print("Importing book...")
    page.locator("data-testid=hidden-file-input").set_input_files(demo_epub_path)

    # Wait for book to appear
    # CSS selector matching attribute starting with value
    book_card = page.locator("[data-testid^='book-card-']").first
    expect(book_card).to_be_visible(timeout=5000)

    # 2. Offload Book
    print("Offloading book...")
    # Open menu (hover to show button, then click)
    book_card.hover()
    page.get_by_test_id("book-context-menu-trigger").click()
    page.wait_for_timeout(1000) # Wait for menu animation

    # Click "Offload File"
    page.get_by_test_id("menu-offload").click(force=True)

    # Confirm Offload
    # Wait for dialog animation
    page.wait_for_timeout(1000)
    # Confirm Offload
    confirm_btn = page.get_by_test_id("confirm-offload")
    expect(confirm_btn).to_have_count(1)
    # Use JS click to bypass potential obstructions
    page.evaluate("document.querySelector('[data-testid=\"confirm-offload\"]').click()")

    # 3. Verify Offloaded State
    # The image should have opacity/grayscale class or overlay
    # We can check for the cloud icon overlay using the robust testid
    expect(page.get_by_test_id("offloaded-overlay")).to_be_visible(timeout=5000)

    # Wait a moment for state update
    page.wait_for_timeout(1000)
    capture_screenshot(page, "library_smart_delete_offloaded")

    # 5. Restore Book (Success Case)
    print("Restoring book...")
    # Trigger the restore flow by clicking the card (which is offloaded)
    book_card.click()

    # Wait for Content Missing dialog
    expect(page.get_by_text("Content Missing")).to_be_visible()

    # Click "Upload File" to trigger file chooser
    with page.expect_file_chooser() as fc_info:
        page.get_by_role("button", name="Upload File").click()

    file_chooser = fc_info.value
    file_chooser.set_files(demo_epub_path)

    # Wait for restore to complete (loader or just state change)
    # The overlay should disappear
    expect(page.get_by_test_id("offloaded-overlay")).not_to_be_visible(timeout=5000)

    capture_screenshot(page, "library_smart_delete_restored")

    # 6. Verify Book Opens
    print("Opening book...")
    # Wait for React state to propagate after restore (isOffloaded flag update)
    # The overlay disappears quickly but React component tree needs time to re-render
    page.wait_for_timeout(3000)

    # Verify the book cover image no longer has the grayscale class (indicates isOffloaded=false in React)
    book_cover_img = page.locator("[data-testid^='book-card-']").first.locator("img").first
    expect(book_cover_img).not_to_have_class(re.compile(r'.*grayscale.*'), timeout=5000)

    # Use a fresh locator to avoid any stale reference issues
    fresh_book_card = page.locator("[data-testid^='book-card-']").first
    fresh_book_card.click()

    # The app may show a reprocessing interstitial if book.version is outdated
    # This happens quickly so we just wait for either the modal to disappear or the URL to change
    # Check for "Upgrading Book..." text which is the modal title
    reprocessing_modal = page.get_by_text("Upgrading Book...")

    # Wait briefly for modal to potentially appear
    page.wait_for_timeout(500)

    if reprocessing_modal.is_visible():
        print("Reprocessing modal appeared - waiting for completion...")
        # Wait for modal to disappear (it navigates on completion)
        expect(reprocessing_modal).not_to_be_visible(timeout=30000)

    # Should navigate to reader (either directly or after reprocessing)
    expect(page).to_have_url(re.compile(r".*/read/.*"), timeout=15000)
    expect(page.get_by_test_id("reader-back-button")).to_be_visible(timeout=5000)

    capture_screenshot(page, "reader_smart_delete_success")
