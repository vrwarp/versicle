import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_tts_settings(page: Page):
    print("Starting TTS Settings Verification...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open book
    print("Opening book...")
    page.get_by_text("Alice's Adventures in Wonderland").first.click()

    # Open TTS Panel
    print("Opening TTS Panel...")
    tts_trigger = page.locator('button[aria-label="Text to Speech"]')
    tts_trigger.wait_for(state="visible", timeout=2000)
    tts_trigger.click()

    # Wait for TTS Panel
    tts_panel = page.locator("h3", has_text="Text to Speech").locator("xpath=../..")
    expect(tts_panel).to_be_visible(timeout=2000)

    # Find Settings button inside TTS Panel
    print("Clicking Voice Settings...")
    settings_btn = tts_panel.locator("button").nth(2)

    settings_btn.click()

    # Verify "Provider" label is visible
    print("Verifying Voice Settings...")
    provider_label = page.get_by_text("Provider")
    expect(provider_label).to_be_visible(timeout=2000)

    # Select "Google Cloud TTS"
    page.select_option('select', 'google')

    # Verify "Google API Key" input is visible
    expect(page.get_by_text("Google API Key")).to_be_visible(timeout=2000)

    # Take screenshot
    print("Taking screenshot...")
    utils.capture_screenshot(page, "tts_settings")
    print("Done.")
