
from playwright.sync_api import Page, expect, sync_playwright
import time

def verify_library_view(page: Page):
    # 1. Arrange: Go to the Library
    # Assuming default vite port is 5173
    page.goto("http://localhost:5173")

    # 2. Wait for the library to load
    # Look for the "My Library" header
    expect(page.get_by_text("My Library")).to_be_visible(timeout=10000)

    # 3. Take a screenshot
    # This verifies the layout is correct and not crashing
    page.screenshot(path="/app/verification/library_view.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        # Launch with args to run in container
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox"])
        page = browser.new_page()
        try:
            verify_library_view(page)
            print("Verification script ran successfully.")
        except Exception as e:
            print(f"Verification failed: {e}")
            page.screenshot(path="/app/verification/error.png")
        finally:
            browser.close()
