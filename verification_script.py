import os
import time
from playwright.sync_api import sync_playwright, expect

def run_cuj(page):
    page.goto("http://localhost:5173", timeout=60000)
    page.wait_for_timeout(2000)

    # Note: Because we are testing library with indexedDB, there may be hanging issues in headless mode as per memory note.
    # However, we will try to navigate to settings to see the dictionary tabs, or open an epub if possible.
    try:
        page.wait_for_selector('button[aria-label="Settings"]', state="visible", timeout=5000)
        page.click('button[aria-label="Settings"]')

        page.wait_for_selector('div[role="dialog"]', state="visible", timeout=5000)

        page.click("text=TTS Engine")
        page.wait_for_timeout(1000)
        page.screenshot(path="/tmp/verification/screenshots/verification_tts.png")
        page.wait_for_timeout(1000)
    except Exception as e:
        print(f"UI interaction failed, taking fallback screenshot: {e}")
        page.screenshot(path="/tmp/verification/screenshots/verification_fallback.png")

if __name__ == "__main__":
    os.makedirs("/tmp/verification/videos", exist_ok=True)
    os.makedirs("/tmp/verification/screenshots", exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            record_video_dir="/tmp/verification/videos",
            ignore_https_errors=True
        )
        page = context.new_page()
        try:
            run_cuj(page)
        except Exception as e:
            print("CUJ failed:", e)
        finally:
            context.close()
            browser.close()
