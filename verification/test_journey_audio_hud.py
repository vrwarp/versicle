import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_audio_hud_interaction(page: Page):
    print("Starting Audio HUD Interaction Test...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    page.locator("[data-testid^='book-card-']").first.click()
    # Wait for Reader
    expect(page.get_by_test_id("reader-back-button")).to_be_visible()

    # Wait for HUD
    # It might take a moment for TTS queue to populate
    expect(page.get_by_test_id("compass-pill-active")).to_be_visible(timeout=10000)
    utils.capture_screenshot(page, "audio_hud_01_visible")

    # Check FAB
    fab = page.get_by_test_id("satellite-fab")
    expect(fab).to_be_visible()

    # Check Play/Pause
    # Initial state should be stopped/paused
    expect(fab).to_have_attribute("aria-label", "Play")

    print("Clicking FAB (Play)...")
    fab.click()

    # Expect state to change to playing -> Pause icon
    expect(fab).to_have_attribute("aria-label", "Pause", timeout=5000)
    utils.capture_screenshot(page, "audio_hud_02_playing")

    print("Clicking FAB (Pause)...")
    fab.click()
    expect(fab).to_have_attribute("aria-label", "Play")
    utils.capture_screenshot(page, "audio_hud_03_paused")

    # Test Summary Mode in Library
    print("Navigating to Library...")
    page.get_by_test_id("reader-back-button").click()

    # Wait for Library
    expect(page).to_have_url("http://localhost:5173/")

    # Check for Summary Pill
    # "If queue is not empty". Queue persists in store.
    expect(page.get_by_test_id("compass-pill-summary")).to_be_visible()

    # Check FAB is hidden
    expect(page.get_by_test_id("satellite-fab")).not_to_be_visible()

    utils.capture_screenshot(page, "audio_hud_04_summary_mode")

    print("Audio HUD Interaction Passed!")
