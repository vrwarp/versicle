from playwright.sync_api import sync_playwright
import time
import os

def capture_search_highlight():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        try:
            print("Navigating to app...")
            page.goto("http://localhost:5173", timeout=10000)

            # Explicitly wait for ANY content
            page.wait_for_load_state("networkidle")

            # Reset logic: Clear Storage to be safe?
            # Actually resetting might be good if state is weird.
            page.evaluate("localStorage.clear()")
            page.reload()
            page.wait_for_load_state("networkidle")

            # Check for Empty Library or Book Card
            # If "Your library is empty" is visible, click Load Demo Book
            if page.get_by_text("Your library is empty").is_visible():
                print("Loading demo book...")
                page.get_by_role("button", name="Load Demo Book").click()
                # Wait for book card to appear
                page.wait_for_selector("[data-testid='book-card']", timeout=5000)

            # Click the book
            print("Opening book...")
            page.get_by_test_id("book-card").click()
            page.wait_for_selector("[data-testid='reader-back-button']", timeout=10000)

            # Wait for indexing
            print("Waiting for indexing...")
            page.wait_for_timeout(3000)

            # Open Search
            print("Searching...")
            page.get_by_test_id("reader-search-button").click()

            # Search for term
            page.get_by_test_id("search-input").fill("waistcoat-pocket")
            page.get_by_test_id("search-input").press("Enter")

            # Wait for results
            page.wait_for_selector("button[data-testid^='search-result-']", timeout=10000)

            # Click result
            print("Clicking result...")
            page.get_by_test_id("search-result-0").click()

            # Wait for highlight
            page.wait_for_timeout(2000)

            # Capture screenshot
            screenshot_path = "verification/search_highlight_visual.png"
            os.makedirs("verification", exist_ok=True)
            page.screenshot(path=screenshot_path)
            print(f"Screenshot saved to {screenshot_path}")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/search_error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    capture_search_highlight()
