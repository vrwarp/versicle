import pytest
import re
import time
from playwright.sync_api import Page, expect
from verification import utils

def test_journey_audio(page: Page):
    print("Starting Audio Journey...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-back-button")).to_be_visible()

    # Navigate to Chapter 5 via TOC to ensure we have content for audio
    print("Navigating to Chapter 5...")
    utils.navigate_to_chapter(page)

    # --- Part 1: Audio HUD Interaction ---
    print("--- Testing Audio HUD ---")
    # Wait for HUD (Compass Pill) in Active/Compact mode (since we have content)
    # The default state when content is available but not playing might be active (if queue populated) or nothing.
    # But navigating to chapter usually populates the queue (as we found earlier).
    # So we expect compass-pill-active.
    expect(page.get_by_test_id("compass-pill-active")).to_be_visible(timeout=10000)
    utils.capture_screenshot(page, "audio_1_hud_visible")

    # Check for Play Button inside the Compass Pill
    # The active variant Compass Pill exposes a Play/Pause toggle in its center section.
    play_button = page.get_by_test_id("compass-pill-active").get_by_label("Play")
    expect(play_button).to_be_visible()

    # Click Play
    print("Clicking Play...")
    play_button.click()
    expect(page.get_by_test_id("compass-pill-active").get_by_label("Pause")).to_be_visible(timeout=5000)

    # Click Pause
    print("Clicking Pause...")
    page.get_by_test_id("compass-pill-active").get_by_label("Pause").click()
    expect(play_button).to_be_visible()

    # --- Part 2: Audio Deck ---
    print("--- Testing Audio Deck ---")
    # Open Audio Deck
    page.get_by_test_id("reader-audio-button").click()

    # Verify Sheet Content
    expect(page.get_by_role("dialog")).to_be_visible()
    expect(page.get_by_text("Audio Deck")).to_be_visible()

    # Verify Stage Buttons
    expect(page.get_by_role("dialog").get_by_label("Play")).to_be_visible()
    expect(page.get_by_test_id("tts-rewind-button")).to_be_visible()
    expect(page.get_by_test_id("tts-forward-button")).to_be_visible()

    # Switch to Settings
    print("Switching to Audio Settings...")
    page.get_by_role("button", name="Settings").click(force=True)
    expect(page.get_by_text("Voice & Pace")).to_be_visible()
    expect(page.get_by_text("Flow Control")).to_be_visible()

    utils.capture_screenshot(page, "audio_2_deck_settings")

    # Switch back to Queue
    print("Switching back to Queue...")
    page.get_by_role("button", name="Up Next").click(force=True)

    # --- Enhanced Queue Assertions ---
    print("Verifying queue content...")
    queue_items = page.locator("[data-testid^='tts-queue-item-']")
    expect(queue_items.first).to_be_visible(timeout=5000)

    queue_count = queue_items.count()
    print(f"Queue contains {queue_count} items")
    assert queue_count >= 3, f"Expected at least 3 queue items, got {queue_count}"

    # Verify first item has text content (not empty)
    first_item_text = page.get_by_test_id("tts-queue-item-0").inner_text()
    print(f"First queue item: {first_item_text[:80]}...")
    assert len(first_item_text.strip()) > 10, "First queue item should have meaningful text content"

    utils.capture_screenshot(page, "audio_2b_queue_verified")

    # Close Audio Deck
    page.keyboard.press("Escape")
    expect(page.get_by_test_id("tts-panel")).not_to_be_visible()

    # --- Part 3: Summary Mode in Library ---
    print("--- Testing Summary Mode in Library ---")
    page.get_by_test_id("reader-back-button").click()

    # Wait for Library
    expect(page).to_have_url("http://localhost:5173/")

    # Check for Summary Pill
    expect(page.get_by_test_id("compass-pill-summary")).to_be_visible()

    # Ensure active pill is gone
    expect(page.get_by_test_id("compass-pill-active")).not_to_be_visible()

    utils.capture_screenshot(page, "audio_3_summary_mode")

    print("Audio Journey Passed!")
