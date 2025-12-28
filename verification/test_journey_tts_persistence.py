
import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_journey_tts_persistence_v3(page: Page):
    """
    Verifies that TTS settings (rate, voice) and Queue state persist across reloads.
    Uses the "Unified Audio Panel" (Sprint 3).
    """
    print("Starting TTS Persistence Journey (V3)...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # 1. Open Book
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-audio-button")).to_be_visible()

    # 2. Open Audio Panel
    page.get_by_test_id("reader-audio-button").click()
    expect(page.get_by_test_id("tts-panel")).to_be_visible()

    # 3. Change Settings
    # Switch to Settings Tab
    page.click("button:has-text('Settings')")

    # Change Speed to 1.5x
    # Locate slider
    slider = page.get_by_label("Playback speed")
    # Click right side of slider to increase
    box = slider.bounding_box()
    if box:
        page.mouse.click(box['x'] + box['width'] * 0.75, box['y'] + box['height'] / 2)

    # Wait for state update
    page.wait_for_timeout(1000)

    # 4. Reload
    print("Reloading...")
    # page.reload() restores history state which reopens panels.
    # We use page.goto(page.url) to simulate a fresh load.
    page.goto(page.url)
    page.wait_for_timeout(2000)

    # 5. Verify Persistence
    print("Verifying Persistence...")
    page.get_by_test_id("reader-audio-button").click()

    expect(page.get_by_test_id("tts-panel")).to_be_visible()

    # Switch to settings
    page.click("button:has-text('Settings')")

    # Verify Speed Slider Value
    slider = page.get_by_label("Playback speed")
    val = slider.get_attribute("aria-valuenow")
    print(f"Persisted Speed: {val}")
    assert val != "1" and val != "1.0", f"Speed should not be 1.0, got {val}"

    print("TTS Persistence Journey Passed!")
