import re
from playwright.sync_api import Page, expect
from verification import utils

def test_lemonfox_settings(page: Page):
    print("Starting LemonFox Settings Verification...")
    utils.reset_app(page)

    # Wait for library to load
    page.wait_for_timeout(1000)

    # Open Global Settings
    print("Opening Global Settings...")
    page.get_by_test_id("header-settings-button").click()

    # Switch to TTS Engine tab
    print("Switching to TTS Engine tab...")
    page.get_by_role("button", name="TTS Engine").click()

    # Verify we are on TTS tab
    expect(page.get_by_text("Provider Configuration")).to_be_visible()

    # Open Provider dropdown
    print("Opening Provider dropdown...")
    # There might be multiple comboboxes (Silent Audio Type). The first one is Active Provider.
    # The label is "Active Provider".
    # Find the SelectTrigger following the label
    # page.locator("text=Active Provider").locator("..").locator("button[role='combobox']").click()
    # Or just use the first combobox in the dialog
    page.locator("button[role='combobox']").first.click()

    # Select LemonFox.ai
    print("Selecting LemonFox.ai...")
    page.get_by_role("option", name="LemonFox.ai").click()

    # Verify LemonFox API Key input appears
    print("Verifying LemonFox API Key input...")
    expect(page.get_by_text("LemonFox API Key")).to_be_visible()

    # Verify input works
    api_key_input = page.locator("input[type='password']").last
    api_key_input.fill("test-lemonfox-key")

    utils.capture_screenshot(page, "lemonfox_settings")

    print("LemonFox Settings Verification Passed!")
