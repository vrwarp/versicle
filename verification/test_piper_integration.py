import pytest
from playwright.sync_api import Page, expect
from verification.utils import reset_app, capture_screenshot

def test_piper_provider_selection(page: Page):
    reset_app(page)

    # Mock voices.json to avoid external network dependency
    mock_voices = """
    {
        "en_US-lessac-high": {
            "key": "en_US-lessac-high",
            "name": "Lessac",
            "language": {
                "code": "en_US",
                "family": "en",
                "region": "US",
                "name_native": "English",
                "name_english": "English"
            },
            "quality": "high",
            "num_speakers": 1,
            "speaker_id_map": {},
            "files": {
                "en_US-lessac-high.onnx": {"size_bytes": 10, "md5_digest": "abc"},
                "en_US-lessac-high.onnx.json": {"size_bytes": 10, "md5_digest": "def"}
            }
        }
    }
    """

    page.route("**/voices.json", lambda route: route.fulfill(
        status=200,
        body=mock_voices,
        headers={"Content-Type": "application/json"}
    ))

    # Open settings
    page.get_by_role("button", name="Settings").click()

    # Go to TTS tab (wait for it to appear which confirms dialog is open)
    page.get_by_role("button", name="TTS Engine").click()

    # Check provider dropdown (initially Web Speech)
    # Radix UI Select trigger
    select_trigger = page.locator('button[role="combobox"]').first
    expect(select_trigger).to_contain_text("Web Speech (Local)")

    select_trigger.click()

    # Select Piper
    page.get_by_role("option", name="Piper (High Quality Local)").click()

    # Verify it is selected
    expect(select_trigger).to_contain_text("Piper")

    # Take screenshot
    capture_screenshot(page, "piper_settings")
