
import os
from playwright.sync_api import sync_playwright, expect

def test_lexicon_preview(page):
    # Go to app
    page.goto("http://localhost:5173/")

    # Wait for library or empty state to ensure app is loaded
    # Targeting the main app wrapper or a known element
    expect(page.get_by_role("button", name="Settings")).to_be_visible()

    # Open Global Settings
    page.get_by_role("button", name="Settings").click()

    # Go to Dictionary Tab
    page.get_by_role("button", name="Dictionary").click()

    # Open Lexicon Manager (Button text is "Manage Rules")
    page.get_by_role("button", name="Manage Rules").click()

    # Check if Lexicon Manager dialog is open
    expect(page.get_by_role("heading", name="Pronunciation Lexicon")).to_be_visible()

    # In Lexicon Manager, type something in test input
    page.get_by_test_id("lexicon-test-input").fill("Testing preview")

    # Click speaker button
    # This should trigger the preview.
    page.get_by_test_id("lexicon-test-btn").click()

    # Wait a moment for potential async errors
    page.wait_for_timeout(1000)

    # Take screenshot of the Lexicon Manager with test input filled
    page.screenshot(path="verification/screenshots/lexicon_preview.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        try:
            test_lexicon_preview(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/screenshots/error.png")
            raise
        finally:
            browser.close()
