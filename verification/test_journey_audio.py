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
    # Wait for HUD (Compass Pill)
    expect(page.get_by_test_id("compass-pill-active")).to_be_visible(timeout=10000)
    utils.capture_screenshot(page, "audio_1_hud_visible")

    # Check FAB
    fab = page.get_by_test_id("satellite-fab")
    expect(fab).to_be_visible()
    expect(fab).to_have_attribute("aria-label", "Play")

    # Click Play
    print("Clicking FAB (Play)...")
    fab.click()
    expect(fab).to_have_attribute("aria-label", "Pause", timeout=5000)

    # Click Pause
    print("Clicking FAB (Pause)...")
    fab.click()
    expect(fab).to_have_attribute("aria-label", "Play")

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
    page.get_by_role("button", name="Settings").click()
    expect(page.get_by_text("Voice & Pace")).to_be_visible()
    expect(page.get_by_text("Flow Control")).to_be_visible()

    utils.capture_screenshot(page, "audio_2_deck_settings")

    # Switch back to Queue
    print("Switching back to Queue...")
    page.get_by_role("button", name="Up Next").click()

    # Close Audio Deck (click outside or use close button if any, or just Escape?)
    # flow_mode.py uses Escape to close audio panel
    page.keyboard.press("Escape")
    expect(page.get_by_test_id("tts-panel")).not_to_be_visible()

    # --- Part 3: Flow Mode (Listening State) ---
    print("--- Testing Flow Mode ---")

    # Open Audio Panel again to start play, or just use FAB
    # Using FAB is easier if it works.
    # But flow_mode test used the panel. Let's use the panel to ensure consistent state entry.
    page.get_by_test_id("reader-audio-button").click()
    page.get_by_test_id("tts-play-pause-button").click()
    page.keyboard.press("Escape")

    # Verify Overlay Appears (Listening State)
    expect(page.get_by_test_id("flow-mode-breathing-border")).to_be_visible(timeout=5000)
    utils.capture_screenshot(page, "audio_3_flow_mode_active")

    # Verify Text Dimming
    container = page.get_by_test_id("reader-iframe-container")
    expect(container).to_have_css("opacity", "0.85")

    # Verify Curtain Mode
    viewport = page.viewport_size
    width = viewport['width'] if viewport else 1280
    height = viewport['height'] if viewport else 720
    center_x = width / 2
    center_y = height / 2

    # Double Tap to enable Curtain
    print("Enabling Curtain Mode...")
    page.mouse.click(center_x, center_y)
    page.mouse.click(center_x, center_y)

    # Verify Curtain is active (black background)
    overlay = page.get_by_test_id("flow-mode-overlay")
    expect(overlay).to_have_class(re.compile(r"bg-black"))
    expect(page.get_by_test_id("flow-mode-breathing-border")).not_to_be_visible()

    # Verify Peek Mode
    print("Testing Peek Mode...")
    time.sleep(2.0)
    page.mouse.click(center_x, center_y)
    expect(overlay).to_contain_text(re.compile(r"\d+:\d+")) # Check for time format
    utils.capture_screenshot(page, "audio_4_curtain_peek")

    # Disable Curtain Mode (Double Tap)
    print("Disabling Curtain Mode...")
    time.sleep(1.0)
    page.mouse.click(center_x, center_y)
    page.mouse.click(center_x, center_y)

    expect(page.get_by_test_id("flow-mode-breathing-border")).to_be_visible()
    expect(overlay).not_to_have_class(re.compile(r"bg-black"))

    # Stop Audio (via Center Tap on Overlay)
    print("Stopping Audio...")
    time.sleep(1.0)
    page.mouse.click(center_x, center_y)

    # Verify Overlay Disappears
    expect(page.get_by_test_id("flow-mode-breathing-border")).not_to_be_visible(timeout=5000)
    expect(container).to_have_css("opacity", "1")

    # --- Part 4: Summary Mode in Library ---
    print("--- Testing Summary Mode in Library ---")
    page.get_by_test_id("reader-back-button").click()

    # Wait for Library
    expect(page).to_have_url("http://localhost:5173/")

    # Check for Summary Pill
    expect(page.get_by_test_id("compass-pill-summary")).to_be_visible()
    # Check FAB is hidden
    expect(page.get_by_test_id("satellite-fab")).not_to_be_visible()

    utils.capture_screenshot(page, "audio_5_summary_mode")

    print("Audio Journey Passed!")
