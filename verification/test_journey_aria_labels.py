import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_aria_labels(page: Page):
    """
    Verifies that ARIA labels are present for accessibility controls in Reader View.
    """
    print("Starting ARIA Labels Verification...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    print("Opening book...")
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-view")).to_be_visible()

    # 1. Visual Settings ARIA Labels
    print("Verifying Visual Settings...")
    page.get_by_label("Visual Settings").click()

    # Font size slider
    expect(page.get_by_label("Font size percentage")).to_be_visible()

    # Line height buttons
    expect(page.get_by_label("Decrease line height")).to_be_visible()
    expect(page.get_by_label("Increase line height")).to_be_visible()

    # Close Settings
    page.get_by_role("button", name="Close").click()

    # 2. Search ARIA Labels
    print("Verifying Search...")
    page.get_by_label("Search").click()
    expect(page.get_by_label("Search query")).to_be_visible()
    expect(page.get_by_label("Close search")).to_be_visible()

    # Close Search
    page.get_by_label("Close search").click()

    # 3. Audio Panel ARIA Labels
    print("Verifying Audio Panel...")
    page.get_by_label("Open Audio Deck").click()

    # Switch to settings tab in Audio Panel
    page.get_by_role("button", name="Settings").click()

    # Playback speed slider
    expect(page.get_by_label("Playback speed")).to_be_visible()

    print("ARIA Labels Verification Passed!")
