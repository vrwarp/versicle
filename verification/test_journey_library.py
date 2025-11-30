import re
import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_library_journey(page: Page):
    print("Starting Library Journey...")
    utils.reset_app(page)

    # 1. Verify Empty Library
    # Initially, there should be no books.
    expect(page.get_by_text("No books yet")).to_be_visible()
    utils.capture_screenshot(page, "library_1_empty")

    # 2. Upload Book
    print("Uploading book...")
    file_input = page.get_by_test_id("file-upload-input")
    file_input.set_input_files("src/test/fixtures/alice.epub")

    # Verify Success Toast
    # Increase timeout to account for processing
    expect(page.get_by_text("Book imported successfully")).to_be_visible(timeout=10000)

    # Verify book appears
    # Cap timeout at 2000ms
    # Using data-testid instead of text for more resilience
    expect(page.get_by_test_id("book-card")).to_be_visible(timeout=5000)
    utils.capture_screenshot(page, "library_2_with_book")

    # 3. Persistence Check
    print("Reloading to check persistence...")
    page.reload()
    expect(page.get_by_test_id("book-card")).to_be_visible(timeout=5000)
    utils.capture_screenshot(page, "library_3_persistence")

    # 4. Navigation Check (Clicking book)
    print("Clicking book to verify navigation...")
    page.get_by_test_id("book-card").click()
    expect(page).to_have_url(re.compile(r".*/read/.*"), timeout=5000)

    # Verify we are in reader view (Back button exists)
    # Also verifying loading state implicitly if we wait for content, but ReaderView test handles that better.
    expect(page.get_by_test_id("reader-back-button")).to_be_visible()
    utils.capture_screenshot(page, "library_4_navigation")

    print("Library Journey Passed!")
