from playwright.sync_api import sync_playwright
import os
from verification import utils

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Create a context with local storage access
        context = browser.new_context()
        page = context.new_page()

        # 1. Load app and reset
        page.goto("http://localhost:5173/")
        page.evaluate("localStorage.clear()")
        page.reload()

        # 2. Upload book (Alice)
        file_path = "src/test/fixtures/alice.epub"
        if not os.path.exists(file_path):
             file_path = "verification/alice.epub"

        page.locator('input[type="file"]').set_input_files(file_path)
        page.locator("[data-testid^='book-card-']").first.click()

        # Wait for reader
        page.wait_for_selector('[data-testid="reader-iframe-container"]')

        # 3. Open Settings and Toggle to Scrolled
        page.locator('[data-testid="reader-settings-button"]').click()
        page.locator('[data-testid="settings-layout-scrolled"]').click()

        # Wait a bit for layout change
        page.wait_for_timeout(1000)

        # Take screenshot of Scrolled Mode Settings
        utils.capture_screenshot(page, "scrolled_mode_settings")

        # Close settings to see the view (though difficult to visualize scrolling in static image without content overflow)
        page.locator('[data-testid="settings-close-button"]').click()
        page.wait_for_timeout(500)
        utils.capture_screenshot(page, "scrolled_mode_view")

        browser.close()

if __name__ == "__main__":
    run()
