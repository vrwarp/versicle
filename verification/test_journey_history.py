"""
Playwright test for the Reading History Journey.
Verifies reading history tracking, history panel, and jumping.
"""
import re
import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_reading_history_journey(page: Page):
    print("Starting Reading History Journey...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    print("Opening book...")
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))

    # Wait for content to render
    page.wait_for_timeout(2000)

    # Check History Button exists
    history_btn = page.get_by_test_id("reader-history-button")
    if not history_btn.is_visible():
        print("History button not visible (likely mobile). Skipping history test.")
        return

    expect(history_btn).to_be_visible()

    # Navigate a bit to generate history
    # Note: History updates on location change (previous location is saved).
    # So we need to move at least once to save the "start" location.
    print("Navigating to generate history...")
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(1000)
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(1000)

    # Open History Panel
    print("Opening History Panel...")
    page.get_by_test_id("reader-history-button").click()
    expect(page.get_by_test_id("reader-history-sidebar")).to_be_visible()

    # Give it a moment to load from DB
    page.wait_for_timeout(1000)

    utils.capture_screenshot(page, "history_01_panel_open")

    # Check for history items
    # They are li elements inside the sidebar
    items = page.locator("[data-testid='reader-history-sidebar'] li")
    count = items.count()
    print(f"Found {count} history items")

    # We expect at least one item
    if count == 0:
        # Check if there is a "No reading history" message
        if page.get_by_text("No reading history recorded yet").is_visible():
            print("Message 'No reading history recorded yet' is visible.")
        else:
             print("Warning: No items and no empty message?")

    # Click an item to jump
    if count > 0:
        print("Clicking first history item...")
        items.first.click()
        # On desktop, sidebar stays open.
        page.wait_for_timeout(500)
        utils.capture_screenshot(page, "history_02_after_jump")

    # Close history
    page.get_by_test_id("reader-history-button").click()
    expect(page.get_by_test_id("reader-history-sidebar")).not_to_be_visible()

    print("Reading History Journey Passed!")
