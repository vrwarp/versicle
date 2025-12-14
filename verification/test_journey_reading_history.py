import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_reading_history_journey(page: Page):
    """
    Verifies that reading history is tracked and displayed in the history panel.
    Steps:
    1. Open book.
    2. Navigate a few pages.
    3. Open History Panel.
    4. Verify entries exist.
    """
    print("Starting Reading History Journey...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    print("Opening book...")
    # Using locator with data-testid to be more precise
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-view")).to_be_visible(timeout=10000)

    # Wait for initial render
    page.wait_for_timeout(5000)

    print("Navigating to next page...")
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(2000)

    print("Navigating to next page again...")
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(2000)

    # Open History Panel
    print("Opening History Panel...")
    history_btn = page.get_by_test_id("reader-history-button")
    expect(history_btn).to_be_visible()
    history_btn.click()
    print("Clicked History Button")

    # Wait for sidebar
    sidebar = page.get_by_test_id("reader-history-sidebar")
    expect(sidebar).to_be_visible()

    # Check for entries
    # Look for the buttons representing history entries
    # The structure is <button class="w-full text-left ...">...</button> inside the sidebar
    entries = sidebar.locator("button.w-full.text-left")

    # Wait a bit for list to render/update if needed
    page.wait_for_timeout(1000)

    count = entries.count()
    print(f"Found {count} history entries in panel.")

    if count == 0:
        pytest.fail("History panel is empty.")

    print("SUCCESS: History panel shows entries.")

    # Capture screenshot
    utils.capture_screenshot(page, "reading_history_panel")
