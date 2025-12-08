import pytest
from playwright.sync_api import Page, expect
import re
from verification import utils

def test_android_workaround_settings(page: Page):
    print("Starting Android Workaround Settings Test...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))
    # Wait for book to load
    page.wait_for_timeout(3000)

    # Open Audio Deck
    page.get_by_test_id("reader-audio-button").click()

    # Switch to Settings
    page.get_by_role("button", name="Settings").click()

    # Verify Android Workaround Section (assuming provider is local by default)
    # Note: reset_app should ensure local provider or we might need to check/set it.
    # But default store state is providerId: 'local'.
    expect(page.get_by_text("Android Workaround")).to_be_visible()
    expect(page.get_by_text("Background Track")).to_be_visible()

    # Verify default state
    expect(page.get_by_text("Silence (Default)")).to_be_visible()

    # Change to White Noise
    # Click the trigger which currently shows "Silence (Default)"
    page.get_by_text("Silence (Default)").click()

    # Select White Noise from the dropdown
    # Radix UI renders options in a portal, usually role="option"
    page.get_by_role("option", name="White Noise").click()

    # Verify Slider appears
    expect(page.get_by_text("Noise Volume")).to_be_visible()

    # Take screenshot
    utils.capture_screenshot(page, "android_workaround_white_noise")

    print("Android Workaround Test Passed!")
