import re
import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_demo_book_journey(page: Page):
    print("Starting Demo Book Journey...")
    utils.reset_app(page)

    # 1. Verify Empty Library
    expect(page.get_by_text("Your library is empty")).to_be_visible()

    # 2. Click "Load Demo Book"
    print("Loading demo book...")
    page.get_by_text("Load Demo Book (Alice in Wonderland)").click()

    # 3. Verify book appears
    expect(page.get_by_test_id("book-card")).to_be_visible(timeout=5000) # Slightly higher timeout for fetch
    utils.capture_screenshot(page, "library_demo_loaded")

    # 4. Verify Metadata
    expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible()

    print("Demo Book Journey Passed!")
