import re
import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_library_journey(page: Page):
    print("Starting Library Journey...")
    utils.reset_app(page)

    # 1. Verify Empty Library
    # Initially, there should be no books.
    utils.capture_screenshot(page, "library_1_empty")

    # 2. Upload Book
    print("Uploading book...")
    file_input = page.locator("input[type='file']")
    file_input.set_input_files("src/test/fixtures/alice.epub")

    # Verify book appears
    # Cap timeout at 2000ms
    expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible(timeout=2000)
    utils.capture_screenshot(page, "library_2_with_book")

    # 3. Persistence Check
    print("Reloading to check persistence...")
    page.reload()
    expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible(timeout=2000)
    utils.capture_screenshot(page, "library_3_persistence")

    # 4. Navigation Check (Clicking book)
    print("Clicking book to verify navigation...")
    page.get_by_text("Alice's Adventures in Wonderland").click()
    expect(page).to_have_url(re.compile(r".*/read/.*"), timeout=2000)

    # Verify we are in reader view (Back button exists)
    expect(page.get_by_label("Back")).to_be_visible()
    utils.capture_screenshot(page, "library_4_navigation")

    print("Library Journey Passed!")
