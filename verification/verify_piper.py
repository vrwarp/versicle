from playwright.sync_api import sync_playwright

def verify_piper_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Intercept voices.json to return mock data
        page.route("**/voices.json", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body='{"en_US-lessac-medium": {"key": "en_US-lessac-medium", "name": "Lessac", "language": {"code": "en_US", "family": "en", "region": "US", "name_native": "English", "name_english": "English"}, "quality": "medium", "num_speakers": 1, "speaker_id_map": {}, "files": {"en_US-lessac-medium.onnx": {"size_bytes": 100, "md5_digest": "abc"}, "en_US-lessac-medium.onnx.json": {"size_bytes": 100, "md5_digest": "abc"}}}}'
        ))

        try:
            # Navigate to app
            page.goto("http://localhost:5173")

            # Wait for settings button in header
            page.wait_for_selector("[data-testid='header-settings-button']")
            page.click("[data-testid='header-settings-button']")

            # Wait for dialog and TTS tab
            page.wait_for_selector("text=TTS Engine")
            page.click("text=TTS Engine")

            # Select Piper provider
            page.click("text=Web Speech (Local)")
            page.click("text=Piper (High Quality Local)")

            # Wait for voices to load and "Select Voice" to appear
            # With mock, it should load quickly.
            # However, logic in store might need to update 'voice' state.

            # Open voice dropdown
            page.wait_for_selector("text=Select Voice")
            page.click("text=Select Voice")

            # Select the mocked voice
            page.click("text=Lessac - medium")

            # Now "Voice Data" section should appear
            page.wait_for_selector("text=Voice Data")
            page.wait_for_selector("text=Download Voice Data")

            # Take screenshot
            page.screenshot(path="/home/jules/verification/piper_settings.png")
            print("Screenshot taken at /home/jules/verification/piper_settings.png")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="/home/jules/verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_piper_ui()
