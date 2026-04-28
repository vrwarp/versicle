import pytest
import re
from playwright.sync_api import Page, expect
from verification import utils

def test_abbrev_settings(page: Page):
    print("Starting Abbreviation Settings Verification...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Click the book to navigate to reader
    # Use first=True to avoid ambiguity if multiple elements match text (e.g. title and author or cover alt)
    page.get_by_text("Alice's Adventures in Wonderland").first.click()

    # Wait for navigation to reader
    expect(page).to_have_url(re.compile(r".*/read/.*"), timeout=10000)

    # Wait for the button to be attached and visible before clicking
    settings_btn = page.locator("button[data-testid='reader-settings-button']")
    settings_btn.wait_for(state="attached", timeout=10000)

    # 1. Open Global Settings
    print("Opening Global Settings...")
    # Remove force=True to ensure it's actually actionable, or retry if it fails
    settings_btn.click(force=True)

    # Retry logic if the dialog doesn't appear
    try:
        expect(page.get_by_role("dialog")).to_be_visible(timeout=5000)
    except Exception:
        print("Retrying click on settings button...")
        settings_btn.click(force=True)
        expect(page.get_by_role("dialog")).to_be_visible(timeout=5000)

    # 2. Switch to Dictionary Tab
    print("Switching to Dictionary Tab...")
    page.get_by_role("button", name="Dictionary").click()

    # 3. Verify TTS/Abbreviation settings are visible.
    # The header has changed from "Sentence Segmentation" to specific sections like "Abbreviations"
    expect(page.get_by_role("heading", name="Abbreviations", exact=True)).to_be_visible(timeout=5000)
    expect(page.get_by_role("heading", name="Always Merge", exact=True)).to_be_visible(timeout=5000)
    expect(page.get_by_role("heading", name="Sentence Starters", exact=True)).to_be_visible(timeout=5000)

    # Check for Export/Import buttons (we have 3 sets now)
    expect(page.locator("button[title='Download CSV']")).to_have_count(3, timeout=5000)
    expect(page.locator("button[title='Upload CSV']")).to_have_count(3, timeout=5000)

    # Take screenshot of the settings panel
    utils.capture_screenshot(page, "abbrev_settings")
    print("Screenshot taken.")
