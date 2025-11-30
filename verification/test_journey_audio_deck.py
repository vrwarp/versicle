import pytest
from playwright.sync_api import Page, expect
import re
from verification import utils

def test_audio_deck_journey(page: Page):
    print("Starting Audio Deck Journey...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    page.locator('[data-testid="book-card"]').click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))
    page.wait_for_timeout(3000) # Wait for text extraction

    # Open Audio Deck
    print("Opening Audio Deck...")
    # New ID: reader-tts-button (kept same ID for compatibility/ease)
    tts_btn = page.get_by_test_id("reader-tts-button")
    tts_btn.click()

    # Verify Sheet Content
    expect(page.get_by_role("dialog")).to_be_visible()
    expect(page.get_by_text("Audio Deck")).to_be_visible()

    # Verify Stage
    # Using aria-labels defined in UnifiedAudioPanel
    expect(page.get_by_label("Play")).to_be_visible()
    expect(page.get_by_label("Rewind 15s")).to_be_visible()
    expect(page.get_by_label("Forward 15s")).to_be_visible()

    # Verify Queue View (Default)
    # Check if we see text from the book (Alice in Wonderland)
    # The queue should populate.
    # Note: TTSQueue rendering depends on extraction.
    page.wait_for_timeout(1000)

    # Switch to Settings
    print("Switching to Settings...")
    page.get_by_role("button", name="Settings").click()

    # Verify Settings View
    expect(page.get_by_text("Voice & Pace")).to_be_visible()
    expect(page.get_by_text("Flow Control")).to_be_visible()

    # Check Switches (radix-ui switch uses button role usually)
    # But we labeled them with text.
    expect(page.get_by_text("Skip URLs & Citations")).to_be_visible()
    expect(page.get_by_text("Announce Chapter Titles")).to_be_visible()

    utils.capture_screenshot(page, "audio_deck_02_settings")

    # Switch back to Queue
    print("Switching back to Queue...")
    page.get_by_role("button", name="Up Next").click()
    page.wait_for_timeout(500)

    utils.capture_screenshot(page, "audio_deck_01_queue")

    print("Audio Deck Journey Passed!")
