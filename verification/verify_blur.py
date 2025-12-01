
import os
import time
from playwright.sync_api import sync_playwright, expect

def verify_blur_consistency(page):
    # Navigate to the app
    page.goto("http://localhost:5173", timeout=10000)

    # Wait for the app to load
    page.wait_for_load_state("networkidle")

    # Take initial screenshot
    page.screenshot(path="verification/01_initial.png")

    # Open Settings
    page.get_by_role("button", name="Settings").click()

    # Wait for Settings Modal to appear
    expect(page.get_by_role("heading", name="Settings", exact=True)).to_be_visible()

    # Wait for animation
    page.wait_for_timeout(500)

    # Take screenshot of Settings Open
    page.screenshot(path="verification/02_settings_open.png")

    # Open Lexicon Manager
    page.get_by_role("button", name="Dictionary").click()
    page.get_by_role("button", name="Manage Rules").click()

    # Wait for Lexicon Dialog
    # The ambiguity is because there is a header in the Settings dialog (section header) named "Pronunciation Lexicon"
    # AND the actual Modal Title is "Pronunciation Lexicon".
    # The Modal Title is h2. The section header is h3.
    # So we target h2 specifically.
    expect(page.locator("h2").filter(has_text="Pronunciation Lexicon")).to_be_visible()

    # Wait for animation
    page.wait_for_timeout(500)

    # Take screenshot of Lexicon Open
    page.screenshot(path="verification/03_lexicon_open.png")

    print("Screenshots captured.")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            verify_blur_consistency(page)
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()
