import time
import os
from playwright.sync_api import sync_playwright, expect

def verify_event_history():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        print("Navigating to app...")
        page.goto("http://localhost:5173")

        # Handle empty library / Load Demo
        try:
            page.wait_for_selector("text=Your library is empty", timeout=3000)
            print("Library empty. Loading demo book...")
            page.click("text=Load Demo Book")
        except:
            print("Library not empty or loaded.")

        # Open book
        print("Opening book...")
        page.wait_for_selector("[data-testid^='book-card-']", timeout=10000)
        page.click("[data-testid^='book-card-']:first-child")

        # Wait for reader
        page.wait_for_selector("[data-testid='reader-view']", timeout=15000)
        print("Reader loaded.")

        # Allow epub.js/iframe to stabilize before freezing time
        # This prevents issues where iframe scripts are blocked if clock is installed too early
        time.sleep(2)

        # Install Clock
        print("Installing clock...")
        page.clock.install()

        # 1. Test Page Event (Dwell)
        print("Dwelling on page 1 for 3s (fast-forward)...")
        page.clock.fast_forward(3000)

        print("Navigating to next page...")
        page.keyboard.press("ArrowRight")

        # Dwell on page 2
        print("Dwelling on page 2 for 3s (fast-forward)...")
        page.clock.fast_forward(3000)

        # 2. Open History
        print("Opening History...")
        page.click("[data-testid='reader-toc-button']")
        page.click("[data-testid='tab-history']")

        # Verify Items
        try:
            page.wait_for_selector("ul.divide-y li", timeout=5000)
            items = page.locator("ul.divide-y li")
            count = items.count()
            print(f"Found {count} history items.")

            if count > 0:
                first_item = items.first
                label = first_item.locator("span").inner_text()
                print(f"First item label: {label}")

                # Check for icons (SVG)
                svg = first_item.locator("svg")
                if svg.count() > 0:
                    print("Icon found.")
                else:
                    print("ERROR: No icon found.")
        except:
            print("No history items found or timeout.")

        browser.close()

if __name__ == "__main__":
    verify_event_history()
