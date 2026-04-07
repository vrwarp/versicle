import os
from playwright.sync_api import sync_playwright
import time

def run_cuj(page):
    # Depending on how the server is run in this container
    page.goto("https://localhost:5173")  # Check HTTPS over port 5173
    page.wait_for_timeout(1000)

    # Click the Notes tab
    try:
        page.get_by_role("button", name="Notes").click()
    except Exception as e:
        print("Could not find Notes button. Assuming we are already there or need different navigation:", e)
        pass

    page.wait_for_timeout(1000)

    # Take screenshot of the screen showing audio bookmarks
    page.screenshot(path="/app/verification/screenshots/verification.png")
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