
import os
import time
from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    try:
        # Wait for server
        page.goto("http://localhost:5173")

        # Open Settings (assuming there is a button for it in the header or sidebar)
        # Based on memories, there is a header-settings-button
        page.get_by_test_id("header-settings-button").click()

        # Wait for dialog
        expect(page.get_by_role("dialog")).to_be_visible()

        # Click TTS Engine tab
        page.get_by_role("button", name="TTS Engine").click()

        # Find Minimum Sentence Length
        expect(page.get_by_text("Minimum Sentence Length")).to_be_visible()

        # Take screenshot of the setting
        page.screenshot(path="verification/min_sentence_length_setting.png")
        print("Screenshot saved to verification/min_sentence_length_setting.png")

    except Exception as e:
        print(f"Error: {e}")
        # Take error screenshot
        page.screenshot(path="verification/error.png")
    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)
