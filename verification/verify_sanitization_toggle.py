import pytest
from playwright.sync_api import Page, expect, sync_playwright
import time
import os

# Ensure screenshot directory exists
os.makedirs("verification/screenshots", exist_ok=True)

def test_sanitization_toggle(page: Page):
    # 1. Open the app
    # Use a longer timeout for initial load in dev
    page.goto("http://localhost:5173", timeout=10000)

    # 2. Wait for library header to ensure app is loaded
    expect(page.get_by_text("Library")).to_be_visible(timeout=15000)

    # 3. Load Book logic
    # Check if we need to load demo book
    # The text is "Load Demo Book (Alice in Wonderland)"
    # It's a button
    demo_button = page.get_by_text("Load Demo Book (Alice in Wonderland)")

    if demo_button.is_visible():
        print("Loading demo book...")
        demo_button.click()
        # Wait for "Alice's Adventures in Wonderland" to appear as a book card
        # This might take time as it fetches and parses
        expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible(timeout=20000)
    else:
        print("Demo book likely already loaded.")

    # 4. Open Reader
    print("Opening reader...")
    # Click the book card title
    page.get_by_text("Alice's Adventures in Wonderland").click()

    # 5. Wait for Reader Content
    # Use locator with testid
    settings_btn = page.locator("button[data-testid='reader-settings-button']")
    expect(settings_btn).to_be_visible(timeout=20000)

    # 6. Open Settings
    print("Opening settings...")
    settings_btn.click()

    # 7. Check Audio Section and Toggle
    # Wait for settings panel
    settings_panel = page.locator("div[data-testid='settings-panel']")
    expect(settings_panel).to_be_visible()

    # Check for "Audio" section header
    expect(page.get_by_text("Audio")).to_be_visible()

    # Check for "Sanitize Text" label
    expect(page.get_by_text("Sanitize Text")).to_be_visible()

    # Check for the toggle button
    toggle = page.locator("button[data-testid='settings-audio-sanitization']")
    expect(toggle).to_be_visible()

    # 8. Verification Actions
    # Toggle OFF
    print("Toggling OFF...")
    toggle.click()
    page.wait_for_timeout(500) # Wait for animation
    page.screenshot(path="verification/screenshots/sanitization_off.png")

    # Toggle ON
    print("Toggling ON...")
    toggle.click()
    page.wait_for_timeout(500) # Wait for animation
    page.screenshot(path="verification/screenshots/sanitization_on.png")

    print("Test completed.")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 720})
        page = context.new_page()
        try:
            test_sanitization_toggle(page)
            print("Verification script completed successfully.")
        except Exception as e:
            print(f"Verification failed: {e}")
            page.screenshot(path="verification/screenshots/error_sanitization.png")
        finally:
            browser.close()
