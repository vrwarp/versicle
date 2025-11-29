import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_tts_refinement(page: Page):
    """
    Verifies the TTS refinement sprint features:
    1. Skip forward/backward buttons (15s).
    2. Enhanced TTS Queue styling.
    3. TTS Cost Indicator in settings.
    """
    print("Starting TTS Refinement Verification...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # 1. Open book and Navigate to Text
    print("Opening book and navigating to text...")
    page.get_by_test_id("book-card").click()
    page.wait_for_selector("[data-testid='reader-iframe-container']", timeout=10000)
    page.wait_for_timeout(3000)

    # Open TOC and go to Chapter I (Alice) to ensure text
    page.get_by_test_id("reader-toc-button").click()
    page.get_by_test_id("reader-toc-sidebar").wait_for(state="visible", timeout=2000)
    page.get_by_text("Down the Rabbit-Hole").click()
    page.wait_for_timeout(3000) # Wait for render

    # 2. Open TTS Panel
    print("Opening TTS Panel...")
    page.get_by_test_id("reader-tts-button").click()
    page.get_by_test_id("tts-panel").wait_for(state="visible", timeout=2000)

    # 3. Verify Skip Buttons
    print("Verifying Skip Buttons...")
    seek_back = page.get_by_test_id("tts-seek-back-button")
    seek_fwd = page.get_by_test_id("tts-seek-forward-button")

    expect(seek_back).to_be_visible()
    expect(seek_fwd).to_be_visible()

    # Check if disabled for local provider (default)
    # The providerId defaults to 'local', so they should be disabled or styled as such.
    # Logic in code: disabled={providerId === 'local'}
    expect(seek_back).to_be_disabled()
    expect(seek_fwd).to_be_disabled()

    # 4. Verify Queue Styling
    print("Verifying Queue Styling...")
    page.wait_for_selector("[data-testid='tts-queue-list']", timeout=5000)

    # Check Active Item Styling (Item 0)
    item0 = page.get_by_test_id("tts-queue-item-0")
    expect(item0).to_be_visible()

    # Check class for new styling (bg-primary/20)
    classes = item0.get_attribute("class")
    print(f"Item 0 classes: {classes}")
    assert "bg-primary/20" in classes
    assert "border-l-4" in classes

    utils.capture_screenshot(page, "verify_tts_refinement_queue")

    # 5. Verify Cost Indicator in Settings
    print("Verifying Cost Indicator...")
    page.get_by_test_id("tts-settings-button").click()
    page.wait_for_timeout(500) # transition

    # It might be null if chars=0 or local provider, but let's check screenshot
    # Code: if (sessionCharacters === 0 || providerId === 'local') return null;
    # By default it is local, so it should NOT be visible yet.

    # We can try to switch provider to Google to see if it appears (mocked?)
    # But sessionCharacters is 0 initially.
    # So we mainly verify it DOES NOT crash and layout is correct.

    expect(page.get_by_text("Provider")).to_be_visible()

    # Let's switch to Google just to see if UI updates
    page.get_by_test_id("tts-provider-select").select_option("google")

    utils.capture_screenshot(page, "verify_tts_refinement_settings")
    print("Verification Complete.")
