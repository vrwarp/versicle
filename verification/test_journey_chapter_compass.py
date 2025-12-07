import pytest
import time
from playwright.sync_api import Page, expect
from verification.utils import ensure_library_with_book, capture_screenshot, reset_app

def test_chapter_compass_journey(page: Page):
    """
    Verifies the Design Sprint 5 "Chapter Compass" features:
    1. Loads the demo book.
    2. Starts TTS playback to trigger the HUD.
    3. Verifies the appearance of the Compass Pill and Satellite FAB.
    4. Tests Play/Pause via FAB.
    5. Tests Next/Prev via Pill.
    6. Takes UX validation screenshots.
    """
    # 1. Setup
    reset_app(page)
    ensure_library_with_book(page)

    # Open the book
    page.get_by_test_id("book-card-alice").click()
    # Wait for reader to load
    page.wait_for_timeout(2000)
    capture_screenshot(page, "reader_loaded")

    # 2. Start TTS
    # The Play button in the reader header usually starts TTS
    # We might need to handle the "No Audio" dialog if it appears, but usually Alice has text.
    # We can use the "Play" button in the header toolbar if available,
    # OR we can open the audio panel and click play.
    # Let's try the header play button first.

    # Assuming there is a play button in the header or we can open the menu.
    # Let's check for 'reader-audio-button' to open panel, then play.
    page.get_by_test_id("reader-audio-button").click()

    # In the panel (sheet), click play.
    # Wait for sheet
    expect(page.get_by_text("Queue")).to_be_visible()

    # Click play in the sheet (usually a big play button or we can click the first item)
    # The UnifiedAudioPanel usually has a main play/pause control.
    # Let's look for an accessible Play button.
    # If not found, we can click the first queue item.

    # Let's try clicking the "Hand" icon or similar if needed, but standard Play is better.
    # Actually, let's just click the first item in the queue list.
    page.locator("[data-testid='tts-queue-item']").first.click()

    # Close the panel to see the HUD
    # Click outside or close button.
    page.keyboard.press("Escape")

    # Wait for HUD to appear (it shows when queue > 0)
    # The pill has text like "Chapter" or the chapter title.
    # The FAB has a Pause icon because we are playing.

    time.sleep(1) # wait for animation

    # 3. Verify HUD Elements

    # Verify Satellite FAB
    fab = page.get_by_label("Pause") # It should be playing now
    expect(fab).to_be_visible()
    capture_screenshot(page, "chapter_compass_playing")

    # Verify Compass Pill
    # It should contain text. Alice Ch 1 title is "Down the Rabbit-Hole"
    expect(page.get_by_text("Down the Rabbit-Hole")).to_be_visible()
    # Check for "min remaining" text
    expect(page.get_by_text("min remaining", exact=False)).to_be_visible()

    # 4. Test Play/Pause FAB
    fab.click()
    # Should now show Play icon
    expect(page.get_by_label("Play")).to_be_visible()
    capture_screenshot(page, "chapter_compass_paused")

    # Click again to resume
    page.get_by_label("Play").click()
    expect(page.get_by_label("Pause")).to_be_visible()

    # 5. Test Navigation via Pill
    # Click Next Chevron
    page.get_by_label("Next sentence").click()
    # Verify we moved (maybe check text or just that it didn't crash)
    # Hard to verify exact text change without robust queue inspection,
    # but we can verify it's still visible and playing.
    expect(fab).to_be_visible()

    # Click Prev Chevron
    page.get_by_label("Previous sentence").click()
    expect(fab).to_be_visible()

    # 6. Verify persistence on Library View
    # Go back to library
    page.go_back()

    # HUD should still be visible because queue is active
    expect(fab).to_be_visible()
    capture_screenshot(page, "chapter_compass_library_view")

    # Stop playback (Long press logic is in spec, but simple click pause is verified.
    # To really clear it, we might need to stop.
    # Let's just pause and end test.
    fab.click()
