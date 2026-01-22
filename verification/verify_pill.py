from playwright.sync_api import Page, expect, sync_playwright
import time

def test_pill_corners(page: Page):
    # Capture console logs
    page.on("console", lambda msg: print(f"Console: {msg.text}"))
    page.on("pageerror", lambda err: print(f"Page Error: {err}"))

    # 1. Navigate to the app
    page.goto("http://localhost:5173/")

    # Debug: print title and wait
    print(f"Page Title: {page.title()}")

    # 2. Wait for the pill to be visible (it has testid "compass-pill-active")
    # Since we forced "active" variant in ReaderControlBar.tsx
    pill = page.get_by_test_id("compass-pill-active")
    expect(pill).to_be_visible(timeout=10000)

    # 3. Take a screenshot of the bottom area where the pill is
    page.wait_for_timeout(2000)

    page.screenshot(path="/home/jules/verification/verification.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_pill_corners(page)
        except Exception as e:
            print(f"Test failed: {e}")
            page.screenshot(path="/home/jules/verification/error.png")
            raise e
        finally:
            browser.close()
