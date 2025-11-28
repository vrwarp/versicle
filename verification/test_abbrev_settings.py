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

    # 1. Open TTS Panel
    print("Opening TTS Panel...")
    page.get_by_label("Text to Speech").click()

    # 2. Open Voice Settings (inside TTS Panel)
    print("Opening Voice Settings...")
    # Try aria-label first
    try:
        page.get_by_label("Voice Settings").click(timeout=1000)
    except:
        # Fallback to nth(2) if label missing
        tts_panel = page.locator("h3", has_text="Text to Speech").locator("xpath=../..")
        tts_panel.locator("button").nth(2).click()

    # 3. Verify TTS/Abbreviation settings are visible.
    expect(page.get_by_text("Sentence Segmentation")).to_be_visible(timeout=2000)

    # Check for Export/Import buttons
    expect(page.locator("button[title='Download CSV']")).to_be_visible(timeout=2000)
    expect(page.locator("button[title='Upload CSV']")).to_be_visible(timeout=2000)

    # Take screenshot of the settings panel
    utils.capture_screenshot(page, "abbrev_settings")
    print("Screenshot taken.")
