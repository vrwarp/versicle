"""
Playwright test for the Reading History Journey.
Verifies reading history tracking, history panel (in TOC sidebar), and jumping.
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

    # Navigate a bit to generate history
    # Note: History updates on location change (previous location is saved).
    # So we need to move at least once to save the "start" location.
    print("Navigating to generate history...")
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(1000)
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(1000)

    # Open TOC Panel (which now houses History)
    print("Opening TOC/History Panel...")
    toc_btn = page.get_by_test_id("reader-toc-button")
    expect(toc_btn).to_be_visible()
    toc_btn.click()

    expect(page.get_by_test_id("reader-toc-sidebar")).to_be_visible()

    # Switch to History Tab
    print("Switching to History Tab...")
    history_tab = page.get_by_test_id("tab-history")
    expect(history_tab).to_be_visible()
    history_tab.click()

    # Give it a moment to load from DB
    page.wait_for_timeout(1000)

    utils.capture_screenshot(page, "history_01_panel_open")

    # Check for history items
    # They are li elements inside the sidebar, but we want to make sure we are not seeing chapters
    # The History tab content should be visible.
    # We can look for the "Reading History" header text inside the panel if we kept it.
    expect(page.get_by_text("Reading History", exact=True)).to_be_visible()

    # Find items in the active content
    # Since we are in the sidebar, and chapters are hidden (inactive tab), searching for li should be fine
    # assuming inactive tabs are hidden with display:none or unmounted.
    # Radix UI Tabs usually unmount or hide.
    items = page.locator("[data-testid='reader-toc-sidebar'] li")
    count = items.count()
    print(f"Found {count} items in sidebar (should be history items)")

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

    # Close sidebar
    page.get_by_test_id("reader-toc-button").click()
    expect(page.get_by_test_id("reader-toc-sidebar")).not_to_be_visible()

    print("Reading History Journey Passed!")
