from playwright.sync_api import Page, expect, sync_playwright
import os

def verify_dark_theme(page: Page):
    # 1. Arrange: Go to the app
    page.goto("http://localhost:5173", timeout=5000)

    # 2. Upload book (Alice)
    file_input = page.get_by_test_id("file-upload-input")
    # Path relative to where we run python
    page.get_by_test_id("file-upload-input").set_input_files("src/test/fixtures/alice.epub")
    expect(page.get_by_test_id("book-card")).to_be_visible(timeout=5000)

    # 3. Open book
    page.get_by_test_id("book-card").click()
    expect(page.get_by_test_id("reader-iframe-container")).to_be_visible()

    # 4. Open Settings
    page.get_by_test_id("reader-settings-button").click()
    expect(page.get_by_text("Reader Settings")).to_be_visible()

    # 5. Select Dark Mode
    page.get_by_label("Dark").click()

    # Close Settings
    page.get_by_test_id("reader-settings-button").click()

    # 6. Wait for update (iframe might take a moment)
    page.wait_for_timeout(2000)

    # 7. Screenshot
    page.screenshot(path="verification_temp/dark_mode_reader.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_dark_theme(page)
        finally:
            browser.close()
