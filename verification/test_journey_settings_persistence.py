import re
import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_settings_persistence(page: Page):
    print("Starting Settings Persistence Journey...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))
    page.wait_for_timeout(2000)

    # 1. Open Audio Panel
    print("Opening Audio Panel...")
    page.get_by_test_id("reader-audio-button").click()

    # Switch to Settings
    page.click("button:has-text('Settings')")

    # 2. Toggle "Announce Chapter Titles" (Enable)
    print("Toggling Announce Chapter Titles (Enable)...")
    # Find the switch
    switch = page.get_by_text("Announce Chapter Titles", exact=True).locator("xpath=..").get_by_role("switch")

    # Ensure it's visible
    expect(switch).to_be_visible()

    # Get current state
    is_checked = switch.get_attribute("aria-checked") == "true"

    # Toggle it
    switch.click()
    page.wait_for_timeout(500)

    # Verify it flipped
    expected_state = "false" if is_checked else "true"
    expect(switch).to_have_attribute("aria-checked", expected_state)

    utils.capture_screenshot(page, "settings_persistence_1_toggled")

    # 3. Reload
    print("Reloading...")
    page.reload()
    page.wait_for_timeout(2000)

    # 4. Verify Persistence
    print("Verifying Persistence...")

    # Open Audio Panel again
    page.get_by_test_id("reader-audio-button").click()
    # Switch to Settings
    page.click("button:has-text('Settings')")

    switch = page.get_by_text("Announce Chapter Titles", exact=True).locator("xpath=..").get_by_role("switch")
    expect(switch).to_have_attribute("aria-checked", expected_state)

    utils.capture_screenshot(page, "settings_persistence_2_restored")

    print("Settings Persistence Journey Passed!")
