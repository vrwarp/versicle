import re
from playwright.sync_api import Page, expect
from verification import utils

def test_reading_history(page: Page):
    print("Starting Reading History Journey...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))
    page.wait_for_timeout(2000)

    # Navigate to a chapter to ensure we are in content flow
    print("Navigating to chapter...")
    utils.navigate_to_chapter(page)
    page.wait_for_timeout(1000)

    # Navigate (Click right edge)
    print("Navigating to next page...")
    viewport = page.viewport_size
    if viewport:
        page.mouse.click(viewport["width"] * 0.9, viewport["height"] * 0.5)
    else:
        page.keyboard.press("ArrowRight")

    page.wait_for_timeout(2000)

    # Navigate again to ensure previous range is saved
    print("Navigating to next page again...")
    if viewport:
        page.mouse.click(viewport["width"] * 0.9, viewport["height"] * 0.5)
    else:
        page.keyboard.press("ArrowRight")
    page.wait_for_timeout(2000)

    # Open History Panel
    print("Opening History Panel...")
    page.get_by_test_id("reader-history-button").click()
    expect(page.get_by_test_id("reader-history-sidebar")).to_be_visible()

    page.wait_for_timeout(1000)
    utils.capture_screenshot(page, "history_03_panel_open")

    # Check for empty state
    if page.get_by_text("No reading history recorded yet.").is_visible():
        print("ERROR: History is empty!")

    # Verify we have items
    items = page.locator("li[role='button']")
    count = items.count()
    print(f"Found {count} history items.")

    assert count > 0, "No history items found!"

    # Test Navigation from History
    print("Clicking first history item...")
    first_item = items.first
    label = first_item.inner_text()
    print(f"Clicking item: {label}")
    first_item.click()

    # Wait for navigation
    page.wait_for_timeout(2000)
    utils.capture_screenshot(page, "history_04_navigated_back")

    print("Reading History Journey Passed!")
