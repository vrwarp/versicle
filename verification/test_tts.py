import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_tts_settings(page: Page):
    print("Starting TTS Settings Verification...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open book
    print("Opening book...")
    page.get_by_test_id("book-card").click()

    # Open TTS Panel
    print("Opening TTS Panel...")
    tts_trigger = page.get_by_test_id("reader-tts-button")
    tts_trigger.wait_for(state="visible", timeout=2000)
    tts_trigger.click()

    # Wait for TTS Panel
    tts_panel = page.get_by_test_id("tts-panel")
    expect(tts_panel).to_be_visible(timeout=2000)

    # Find Settings button inside TTS Panel
    print("Clicking Voice Settings...")
    settings_btn = page.get_by_test_id("tts-settings-button")

    settings_btn.click()

    # Verify "Provider" label is visible (or check select existence)
    print("Verifying Voice Settings...")
    expect(page.get_by_test_id("tts-provider-select")).to_be_visible(timeout=2000)

    # Select "Google Cloud TTS"
    page.get_by_test_id("tts-provider-select").select_option('google')

    # Verify "Google API Key" input is visible
    # I didn't add test-id for api key input explicitly in my plan, but I can check text or add it.
    # Looking at ReaderView.tsx, I didn't add it.
    expect(page.get_by_text("Google API Key")).to_be_visible(timeout=2000)

    # Take screenshot
    print("Taking screenshot...")
    utils.capture_screenshot(page, "tts_settings_panel")
    print("Done.")
