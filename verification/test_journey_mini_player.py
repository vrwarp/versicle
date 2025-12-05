import pytest
from playwright.sync_api import Page, expect
from utils import reset_app, ensure_library_with_book, capture_screenshot

def test_journey_mini_player(page: Page):
    """
    User Journey: Persistent Audio & Mini Player
    1. Open a book and start audio playback.
    2. Navigate back to the library (audio continues).
    3. Verify Mini Player appears with correct metadata.
    4. Use Mini Player controls (Pause/Play).
    5. Expand Mini Player to full Audio Panel.
    6. Close Audio Panel.
    7. Stop playback and verify Mini Player dismissal.
    """
    reset_app(page)
    ensure_library_with_book(page)

    # 1. Open Book
    page.click("text=Alice's Adventures in Wonderland")
    page.wait_for_timeout(2000) # Wait for book load

    # 2. Start Playback
    page.get_by_test_id("reader-audio-button").click()
    page.get_by_test_id("tts-play-pause-button").click()

    # Wait for playing state (Mock TTS might be fast, so pause quickly to keep it active)
    page.wait_for_timeout(500)
    page.get_by_test_id("tts-play-pause-button").click() # Pause to keep status 'paused'

    # 3. Navigate Back to Library (Close Audio Panel first if needed, but it's a sheet, so usually clicking outside or escape works)
    # The Audio Panel is open from step 2. We should close it or just navigate back?
    # Navigation back button is in Reader Header. Audio Panel overlays it.
    # We must close Audio Panel first.
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    expect(page.get_by_test_id("reader-audio-button")).to_be_visible()

    page.get_by_test_id("reader-back-button").click()

    # 4. Verify Library View & Mini Player
    expect(page.get_by_test_id("library-view")).to_be_visible()

    mini_player = page.get_by_test_id("mini-player")
    expect(mini_player).to_be_visible()
    expect(mini_player).to_contain_text("Alice's Adventures in Wonderland")

    capture_screenshot(page, "mini_player_visible")

    # 5. Interact with Mini Player
    # Resume
    mini_player.get_by_test_id("mini-player-play-pause").click()
    page.wait_for_timeout(500)
    # Pause
    mini_player.get_by_test_id("mini-player-play-pause").click()

    # 6. Expand to Audio Panel
    # Click on the text part (not button)
    mini_player.click(position={"x": 100, "y": 20})

    expect(page.get_by_test_id("tts-panel")).to_be_visible()
    capture_screenshot(page, "audio_panel_expanded_from_mini")

    # 7. Close Audio Panel
    page.keyboard.press("Escape")
    expect(page.get_by_test_id("tts-panel")).not_to_be_visible()

    # 8. Stop Playback
    expect(mini_player).to_be_visible()
    mini_player.get_by_test_id("mini-player-close").click()
    expect(mini_player).not_to_be_visible()

    capture_screenshot(page, "mini_player_dismissed")
