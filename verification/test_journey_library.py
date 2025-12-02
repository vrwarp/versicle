import re
import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_library_journey(page: Page):
    print("Starting Library Journey...")
    utils.reset_app(page)

    # 1. Verify Empty Library
    # Initially, there should be no books.
    expect(page.get_by_text("Your library is empty")).to_be_visible()
    expect(page.get_by_text("Import an EPUB file")).to_be_visible()
    utils.capture_screenshot(page, "library_1_empty")

    # 2. Upload Book
    print("Uploading book...")
    # Use the hidden file input which is now present in the new implementation
    file_input = page.get_by_test_id("hidden-file-input")
    file_input.set_input_files("src/test/fixtures/alice.epub")

    # Verify book appears
    # Cap timeout at 2000ms
    # Using data-testid instead of text for more resilience
    expect(page.locator("[data-testid^='book-card-']").first).to_be_visible(timeout=2000)
    utils.capture_screenshot(page, "library_2_with_book")

    # 3. Persistence Check
    print("Reloading to check persistence...")
    page.reload()
    expect(page.locator("[data-testid^='book-card-']").first).to_be_visible(timeout=2000)
    # library_3_persistence removed as redundant

    # 4. Navigation Check (Clicking book)
    print("Clicking book to verify navigation...")
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page).to_have_url(re.compile(r".*/read/.*"), timeout=2000)

    # Verify we are in reader view (Back button exists)
    expect(page.get_by_test_id("reader-back-button")).to_be_visible()
    utils.capture_screenshot(page, "library_reader_view")

    print("Library Journey Passed!")
