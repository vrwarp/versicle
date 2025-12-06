import pytest
from playwright.sync_api import Page, expect
from verification.utils import reset_app, ensure_library_with_book, capture_screenshot

def test_journey_mini_player(page: Page):
    """
    User Journey: Persistent Audio & Mini Player
    1. Open a book and start audio playback.
    2. Verify Mini Player appears in Reader View.
    3. Navigate back to the library (audio continues).
    4. Verify Mini Player DOES NOT appear in Library View (per user request).
    5. Navigate back to Reader View.
    6. Verify Mini Player reappears.
    """
    reset_app(page)
    ensure_library_with_book(page)

    # 1. Open Book
    page.click("text=Alice's Adventures in Wonderland")
    page.wait_for_timeout(2000) # Wait for book load

    # 2. Start Playback
    page.get_by_test_id("reader-audio-button").click()
    page.get_by_test_id("tts-play-pause-button").click()

    # Wait for playing state
    page.wait_for_timeout(500)
    # Pause to check MiniPlayer
    page.get_by_test_id("tts-play-pause-button").click()

    # Close Audio Panel
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)

    # Verify Mini Player in Reader View
    mini_player = page.get_by_test_id("mini-player")
    expect(mini_player).to_be_visible()

    # 3. Navigate Back to Library
    page.get_by_test_id("reader-back-button").click()

    # 4. Verify Library View & NO Mini Player
    expect(page.get_by_test_id("library-view")).to_be_visible()
    expect(mini_player).not_to_be_visible()

    capture_screenshot(page, "mini_player_hidden_in_library")

    # 5. Navigate back to Reader View
    page.click("text=Alice's Adventures in Wonderland")
    page.wait_for_timeout(2000)

    # 6. Verify Mini Player Reappears
    expect(mini_player).to_be_visible()
    capture_screenshot(page, "mini_player_visible_reader")

    # 7. Use Controls
    # Resume
    mini_player.get_by_test_id("mini-player-play-pause").click()
    page.wait_for_timeout(500)
    # Pause
    mini_player.get_by_test_id("mini-player-play-pause").click()

    # 8. Stop
    mini_player.get_by_test_id("mini-player-close").click()
    expect(mini_player).not_to_be_visible()
