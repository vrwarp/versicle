import pytest
from playwright.sync_api import Page, expect
from verification import utils
import re

def test_audio_panel_journey(page: Page):
    print("Starting Audio Panel Journey...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # 1. Open Reader
    page.locator('[data-testid="book-card"]').click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))
    # Wait for reader to be ready
    expect(page.get_by_test_id("reader-iframe-container")).to_be_visible(timeout=10000)

    # 2. Open Audio Panel
    audio_btn = page.get_by_test_id("reader-tts-button")
    audio_btn.click()

    # Verify Audio Panel is visible
    expect(page.get_by_test_id("tts-panel")).to_be_visible()

    # 3. Switch to Settings
    settings_btn = page.get_by_role("button", name="Settings")
    settings_btn.click()

    # 4. Verify Gesture Mode Toggle
    expect(page.get_by_text("Gesture Mode (Eyes Free)")).to_be_visible()

    # 5. Capture Screenshot
    utils.capture_screenshot(page, "audio_panel_settings")

    print("Audio Panel Journey Passed!")
