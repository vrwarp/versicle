
import os
import time
from playwright.sync_api import sync_playwright, expect

def verify_smart_toc(page):
    # Navigate to app
    page.goto("http://localhost:5173", timeout=20000)

    # Wait for library to load and ensure we have a book (Alice)
    # The empty state has a "Load Demo Book" button if needed
    try:
        if page.get_by_role("button", name="Load Demo Book").is_visible():
            page.get_by_role("button", name="Load Demo Book").click(timeout=3000)
            time.sleep(5) # Wait for ingestion
    except:
        pass # Book might already be there

    # Click on the first book card to open reader
    # Use get_by_test_id (pythonic)
    page.locator('[data-testid^="book-card-"]').first.click()

    # Wait for reader to load
    expect(page.get_by_test_id("reader-view")).to_be_visible(timeout=20000)

    # Open TOC
    page.get_by_test_id("reader-toc-button").click()

    # Verify TOC sidebar is visible
    expect(page.get_by_test_id("reader-toc-sidebar")).to_be_visible()

    # Toggle "Generated Titles"
    # Switch label might be distinct from the input, using get_by_label
    # "Generated Titles" is the text in the Label component associated with the switch
    switch = page.get_by_label("Generated Titles")
    switch.click()

    # Verify "Enhance Titles with AI" button appears
    enhance_btn = page.get_by_role("button", name="Enhance Titles with AI")
    expect(enhance_btn).to_be_visible()

    # Take screenshot of the button and sidebar
    os.makedirs("verification", exist_ok=True)
    page.screenshot(path="verification/smart_toc_ui.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Grant permissions for indexedDB if needed, though usually fine in headless
        context = browser.new_context()
        page = context.new_page()
        try:
            verify_smart_toc(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error_smart_toc.png")
        finally:
            browser.close()
