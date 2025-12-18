import pytest
from playwright.sync_api import Page, expect
from verification import utils

TTS_ACTIONS = [
    ("play", "tts-play-button"),
    ("pause", "tts-pause-button"),
    ("next_sentence", "tts-next-button"),
    ("prev_sentence", "tts-prev-button"),
    ("expand_panel", "audio-panel-expand"),
    ("minimize_panel", "audio-panel-minimize"),
]

@pytest.mark.parametrize("action, test_id", TTS_ACTIONS)
def test_journey_tts_actions(page: Page, action, test_id):
    print(f"Starting TTS Journey: {action}...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open book
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-settings-button")).to_be_visible()

    # If pausing or minimizing, we need a pre-state
    if action == "pause":
        expect(page.get_by_test_id("tts-play-button")).to_be_visible()
        page.get_by_test_id("tts-play-button").click()
        expect(page.get_by_test_id("tts-pause-button")).to_be_visible()

    if action == "minimize_panel":
        if page.get_by_test_id("audio-panel-expand").is_visible():
             page.get_by_test_id("audio-panel-expand").click()
        expect(page.get_by_test_id("audio-panel-minimize")).to_be_visible()

    # Perform action if visible
    target = page.get_by_test_id(test_id)

    if not target.is_visible():
        # Try expanding panel if we are looking for controls
        if page.get_by_test_id("audio-panel-expand").is_visible():
             page.get_by_test_id("audio-panel-expand").click()

    expect(target).to_be_visible()
    target.click()
    utils.capture_screenshot(page, f"tts_{action}")

SPEED_PARAMS = [
    ("speed_0.5", 0.5),
    ("speed_1.0", 1.0),
    ("speed_1.5", 1.5),
    ("speed_2.0", 2.0),
]

@pytest.mark.parametrize("speed_name, rate", SPEED_PARAMS)
def test_journey_tts_speed(page: Page, speed_name, rate):
    utils.reset_app(page)
    utils.ensure_library_with_book(page)
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-settings-button")).to_be_visible()

    # Open audio panel
    if page.get_by_test_id("audio-panel-expand").is_visible():
        page.get_by_test_id("audio-panel-expand").click()

    speed_btn = page.get_by_test_id("playback-rate-button")
    expect(speed_btn).to_be_visible()

    # Click a few times to simulate cycling
    speed_btn.click()
    utils.capture_screenshot(page, f"tts_{speed_name}")
