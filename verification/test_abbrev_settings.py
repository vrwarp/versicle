import pytest
import re
from playwright.sync_api import Page, expect
from verification import utils

def test_abbrev_settings(page: Page):
    print("Starting Abbreviation Settings Verification...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Click the book to navigate to reader
    page.get_by_text("Alice's Adventures in Wonderland").click()

    # Wait for navigation to reader
    expect(page).to_have_url(re.compile(r".*/read/.*"), timeout=2000)

    # 1. Open Global Settings
    print("Opening Global Settings...")
    page.click("button[data-testid='reader-settings-button']")
    expect(page.get_by_role("dialog")).to_be_visible()

    # 2. Switch to Dictionary Tab
    print("Switching to Dictionary Tab...")
    page.get_by_role("button", name="Dictionary").click()

    # 3. Verify TTS/Abbreviation settings are visible.
    # The header has changed from "Sentence Segmentation" to specific sections like "Abbreviations"
    expect(page.get_by_role("heading", name="Abbreviations")).to_be_visible(timeout=2000)
    expect(page.get_by_role("heading", name="Always Merge")).to_be_visible(timeout=2000)
    expect(page.get_by_role("heading", name="Sentence Starters")).to_be_visible(timeout=2000)

    # Check for Export/Import buttons (we have 3 sets now)
    expect(page.locator("button[title='Download CSV']")).to_have_count(3, timeout=2000)
    expect(page.locator("button[title='Upload CSV']")).to_have_count(3, timeout=2000)

    # Take screenshot of the settings panel
    utils.capture_screenshot(page, "abbrev_settings")
    print("Screenshot taken.")
