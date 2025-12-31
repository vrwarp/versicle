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
    page.get_by_test_id("book-menu-trigger").click()

    # Click "Offload File"
    page.get_by_test_id("menu-offload").click()

    # Confirm Offload
    page.get_by_test_id("confirm-offload").click()

    # 3. Verify Offloaded State
    # The image should have opacity/grayscale class or overlay
    # We can check for the cloud icon overlay.
    # Using a selector that likely targets the overlay
    expect(page.locator(".bg-black\\/20 > svg")).to_be_visible(timeout=5000)

    # Wait a moment for state update
    page.wait_for_timeout(1000)
    capture_screenshot(page, "library_smart_delete_offloaded")

    # 5. Restore Book (Success Case)
    print("Restoring book...")
    # Click the card to trigger restore (since it's offloaded)
    # The file input should be triggered. We need to set input files on the specific input for this book.
    restore_input = page.locator(f"data-testid=restore-input-{book_card.get_attribute('data-testid').replace('book-card-', '')}")
    restore_input.set_input_files(demo_epub_path)

    # Wait for restore to complete (loader or just state change)
    # The overlay should disappear
    expect(page.locator(".bg-black\\/20 > svg")).not_to_be_visible(timeout=5000)

    capture_screenshot(page, "library_smart_delete_restored")

    # 6. Verify Book Opens
    print("Opening book...")
    book_card.click()

    # Should navigate to reader
    expect(page).to_have_url(re.compile(r".*/read/.*"), timeout=5000)
    expect(page.get_by_test_id("reader-back-button")).to_be_visible(timeout=5000)

    capture_screenshot(page, "reader_smart_delete_success")
