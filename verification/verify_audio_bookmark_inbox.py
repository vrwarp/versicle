import os
from playwright.sync_api import sync_playwright

def run_cuj(page):
    # Navigate to app
    page.goto("https://localhost:5173")
    page.wait_for_timeout(2000)

    try:
        # Click the Notes tab (the global inbox)
        page.get_by_role("button", name="Notes").click()
    except Exception as e:
        print("Could not find Notes button:", e)

    page.wait_for_timeout(1000)
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