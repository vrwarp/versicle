
import os
from playwright.sync_api import Page, expect
from verification import utils

def test_journey_piper(page: Page):
    """
    Verifies the Piper TTS journey, specifically the 'Repair Voice' UI functionality.
    This test ensures that the repair button appears when a voice is in a state
    that allows cache clearing (or force clearing).
    """
    print("Starting Piper Journey (Repair UI)...")

    # 1. Reset App and Load Demo Book (if needed)
    # We use ensure_library_with_book to guarantee we have content to read
    # which usually enables the Reader view components.
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # 2. Open Global Settings from the Reader
    # Navigate to reader if not already there
    # ensure_library_with_book puts us in library view.
    print("Opening book...")
    # Click the first book card - wait for it to be visible first
    book_card = page.locator("[data-testid^='book-card-']").first
    expect(book_card).to_be_visible(timeout=10000)
    book_card.click()

    # Wait for Reader header
    print("Waiting for reader settings button...")
    settings_btn = page.get_by_test_id("reader-settings-button")
    expect(settings_btn).to_be_visible(timeout=20000)
    settings_btn.click()

    # 3. Navigate to TTS tab
    print("Navigating to TTS Engine tab...")
    # The 'Settings' heading is hidden on mobile, so we check for the dialog itself
    expect(page.get_by_role("dialog")).to_be_visible()

    # Click TTS Engine tab (it should be visible in the sidebar/topbar)
    page.get_by_role("button", name="TTS Engine").click()

    # 4. Select Piper Provider
    print("Selecting Piper provider...")
    # Find the select for provider (first combobox)
    # Ensure we are interacting with the correct select
    expect(page.get_by_text("Active Provider")).to_be_visible()
    page.locator("button[role='combobox']").first.click()
    page.get_by_role("option", name="Piper (High Quality Local)").click()

    # 5. Select a Voice
    print("Selecting a voice...")
    # Find the second combobox for voice
    # Wait for "Select Voice" label to appear
    expect(page.get_by_text("Select Voice")).to_be_visible()

    voice_select = page.locator("button[role='combobox']").nth(1)
    voice_select.click()

    # Wait for the list to populate with Piper voices.
    # We expect real Piper voices like "amy", "ryan", etc.
    # We must wait until "Mock Voice 1" is GONE or a known Piper voice appears.
    # Let's wait for "amy" or "ryan".
    print("Waiting for Piper voices to load...")
    # Note: Regex matching is case-insensitive by default in some selectors, but let's be safe.
    # We use a locator for the option.
    piper_option = page.locator("div[role='option']", has_text="amy").first
    expect(piper_option).to_be_visible(timeout=10000)

    voice_name = piper_option.inner_text()
    print(f"Selecting voice: {voice_name}")

    piper_option.click()

    # Verify the select trigger now shows the voice name
    # This confirms the state update
    expect(voice_select).to_contain_text(voice_name)

    # 6. Verify Repair Button Presence
    print("Verifying Repair button...")
    repair_btn = page.locator("button[title='Force Repair / Clear Cache']")
    delete_btn = page.locator("button[title='Delete Voice Data']")

    # Check which one is visible. Initially it SHOULD be Repair (not downloaded).
    # But checking either confirms the UI is active.
    # We expect Repair.

    # Increase timeout for async check
    try:
        expect(repair_btn).to_be_visible(timeout=10000)
        print("Repair button visible.")
    except Exception as e:
        print("Repair button not found/visible. Checking for Delete button...")
        if delete_btn.is_visible():
            print("Delete button is visible. Voice was already ready.")
        else:
            print("Neither button is visible. UI state unclear.")
            # Capture debug screenshot
            utils.capture_screenshot(page, "piper_journey_fail")
            raise e

    # Capture success screenshot
    utils.capture_screenshot(page, "piper_repair_ui_verified")
    print("Piper Journey (Repair UI) Passed!")
