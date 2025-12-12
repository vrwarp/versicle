import pytest
from playwright.sync_api import sync_playwright, expect
import os
import time

def test_android_journey():
    """
    Connects to the Android Emulator via CDP, verifies the app loads,
    loads the demo book, and captures a screenshot.
    """
    print("Connecting to CDP at ws://localhost:9222...")
    with sync_playwright() as p:
        # Retry connection logic
        browser = None
        for i in range(10):
            try:
                browser = p.chromium.connect_over_cdp("ws://localhost:9222")
                break
            except Exception as e:
                print(f"Connection attempt {i+1} failed: {e}")
                time.sleep(2)

        if not browser:
             pytest.fail("Could not connect to CDP")

        # Get context and page
        context = browser.contexts[0]
        # In Android WebView, the main page might take a moment to appear in the context list
        # or we might need to find the right one.
        page = None
        for _ in range(5):
            if context.pages:
                page = context.pages[0]
                break
            time.sleep(1)

        if not page:
            pytest.fail("No pages found in Android WebView context")

        print(f"Connected to page: {page.title()}")

        # Set timeouts
        page.set_default_timeout(10000)

        # Ensure we are in the app (wait for root element or text)
        try:
             # Wait for either the empty state text or a book card or the load button
             page.wait_for_selector("text=Library, [data-testid^='book-card-']", timeout=15000)
        except Exception as e:
             os.makedirs("verification/screenshots", exist_ok=True)
             page.screenshot(path="verification/screenshots/android_timeout.png")
             print(f"Timeout waiting for app load. Screenshot saved to verification/screenshots/android_timeout.png")
             raise e

        # Attempt to load demo book if library is empty
        if page.get_by_text("Your library is empty").is_visible():
             print("Library is empty. Attempting to load demo book...")
             load_btn = page.get_by_role("button", name="Load Demo Book")
             if load_btn.is_visible():
                 load_btn.click()
                 # Wait for book card
                 page.wait_for_selector("[data-testid^='book-card-']", timeout=10000)
             else:
                 print("Load Demo Book button not found.")

        # Capture Screenshot
        os.makedirs("verification/screenshots", exist_ok=True)
        page.screenshot(path="verification/screenshots/android_library.png")
        print("Screenshot saved to verification/screenshots/android_library.png")

        browser.close()
