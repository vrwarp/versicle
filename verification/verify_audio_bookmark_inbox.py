import os
from playwright.sync_api import sync_playwright

def run_cuj(page):
    # Adjust to standard Vite port
    page.goto("https://localhost:5173")
    page.wait_for_timeout(1000)

    # Note: As this tests the global inbox, we first mock an audio bookmark into the IndexedDB/Yjs state or use the app directly to create one.
    # Because triggering the double-pause logic via the UI in a script without TTS backend might be complex,
    # let's test the UI rendering of the Audio Bookmarks Inbox directly if we navigate to it.

    # 1. Open the library view and click the Notes tab
    try:
        page.get_by_role("button", name="Notes").click()
    except Exception as e:
        print("Could not find Notes button:", e)

    page.wait_for_timeout(1000)

    # Take screenshot of the screen (should show Notes View, ideally with an empty or populated Audio Bookmarks Inbox)
    page.screenshot(path="/app/verification/screenshots/audio_bookmark_inbox.png")
    page.wait_for_timeout(1000)

if __name__ == "__main__":
    os.makedirs("/app/verification/videos", exist_ok=True)
    os.makedirs("/app/verification/screenshots", exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            record_video_dir="/app/verification/videos",
            ignore_https_errors=True
        )
        page = context.new_page()
        try:
            run_cuj(page)
        finally:
            context.close()
            browser.close()