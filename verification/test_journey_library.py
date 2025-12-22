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

    # 2. Test "Load Demo Book"
    print("Testing Load Demo Book...")
    page.get_by_text("Load Demo Book (Alice in Wonderland)").click()

    # Verify book appears
    # Using locator with data-testid to be more precise
    book_card = page.locator("[data-testid^='book-card-']").first
    expect(book_card).to_be_visible(timeout=5000)
    expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible()

    utils.capture_screenshot(page, "library_2_demo_loaded")

    # 3. Test Delete (Smart Delete / Remove)
    print("Testing Delete Book...")
    book_card.hover()
    page.get_by_test_id("book-menu-trigger").click()
    page.get_by_test_id("menu-delete").click()
    page.get_by_test_id("confirm-delete").click()

    # Verify Empty Again
    expect(book_card).not_to_be_visible(timeout=5000)
    expect(page.get_by_text("Your library is empty")).to_be_visible()
    utils.capture_screenshot(page, "library_3_deleted")

    # 4. Upload Book
    print("Uploading book...")
    # Use the hidden file input which is now present in the new implementation
    file_input = page.get_by_test_id("hidden-file-input")
    file_input.set_input_files("src/test/fixtures/alice.epub")

    # Verify book appears
    expect(page.locator("[data-testid^='book-card-']").first).to_be_visible()
    utils.capture_screenshot(page, "library_4_uploaded")

    # 5. Persistence Check
    print("Reloading to check persistence...")
    page.reload()
    expect(page.locator("[data-testid^='book-card-']").first).to_be_visible()

    # 6. Navigation Check (Clicking book)
    print("Clicking book to verify navigation...")
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))

    # Verify we are in reader view (Back button exists)
    expect(page.get_by_test_id("reader-back-button")).to_be_visible()
    utils.capture_screenshot(page, "library_5_reader_view")

    print("Library Journey Passed!")
