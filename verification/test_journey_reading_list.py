import re
import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_reading_list_journey(page: Page):
    print("Starting Reading List Journey...")
    utils.reset_app(page)

    # 1. Upload Book
    print("Uploading book...")
    # Alice should be available in verification/alice.epub
    file_input = page.get_by_test_id("hidden-file-input")
    file_input.set_input_files("verification/alice.epub")

    expect(page.locator("[data-testid^='book-card-']").first).to_be_visible()

    # 2. Open Book and Read
    print("Opening book...")
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-iframe-container")).to_be_visible()

    # Advance a page to record progress
    print("Reading...")
    # Wait for book to render
    page.wait_for_timeout(2000)
    page.keyboard.press("ArrowRight")
    # Wait for debounce save (1s) + margin
    page.wait_for_timeout(2000)

    # 3. Go back to Library
    page.get_by_test_id("reader-back-button").click()
    expect(page.get_by_test_id("library-view")).to_be_visible()

    # 4. Open Settings -> Data Management -> View List
    print("Opening Reading List...")
    page.get_by_test_id("header-settings-button").click()
    page.get_by_role("button", name="Data Management").click()
    page.get_by_role("button", name="View List").click()

    # 5. Verify Entry
    print("Verifying entry...")
    # Target the reading list modal specifically using the heading
    reading_list_modal = page.get_by_role("dialog").filter(has=page.get_by_role("heading", name="Reading List"))
    expect(reading_list_modal).to_be_visible()

    # Check if Alice is there (inside the modal)
    expect(reading_list_modal.get_by_text("Alice's Adventures in Wonderland")).to_be_visible()

    # Check for "Reading" status badge
    expect(reading_list_modal.get_by_text("Reading", exact=True)).to_be_visible()

    utils.capture_screenshot(page, "reading_list_view")

    print("Reading List Journey Passed!")
