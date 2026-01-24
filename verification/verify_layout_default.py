import os
import time
from playwright.sync_api import sync_playwright, expect

def verify_layout_default():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # 1. Open the app
        print("Navigating to app...")
        page.goto("http://localhost:5173")

        # 2. Check for books. If none, import one.
        print("Checking for books...")
        page.wait_for_timeout(2000)

        book_cards = page.locator("[data-testid^='book-card-']")
        if book_cards.count() == 0:
            print("No books found. Importing Alice...")

            # Use the hidden file input
            file_input = page.locator("[data-testid='hidden-file-input']")

            # Path to alice.epub
            # We assume we are running from repo root
            epub_path = os.path.abspath("src/test/fixtures/alice.epub")
            if not os.path.exists(epub_path):
                epub_path = os.path.abspath("public/books/alice.epub")
            if not os.path.exists(epub_path):
                # Try verification dir
                epub_path = os.path.abspath("verification/alice.epub")

            if os.path.exists(epub_path):
                file_input.set_input_files(epub_path)
                print(f"Imported {epub_path}")
                # Wait for import to process (loading spinner etc)
                page.wait_for_timeout(3000)
            else:
                print(f"Could not find alice.epub fixture at {epub_path}")
                return

        # 3. Open the first book
        print("Opening book...")
        book_cards = page.locator("[data-testid^='book-card-']")
        # Refresh locator
        if book_cards.count() > 0:
            book_cards.first.click()
        else:
            print("Still no books found after import attempt.")
            page.screenshot(path="/home/jules/verification/failed_no_books.png")
            return

        # 4. Wait for Reader to load
        print("Waiting for reader...")
        # Wait for visual settings button
        try:
            page.wait_for_selector("[data-testid='reader-visual-settings-button']", timeout=15000)
        except:
             print("Timeout waiting for reader. Screenshotting.")
             page.screenshot(path="/home/jules/verification/failed_reader_load.png")
             return

        # 5. Open Visual Settings
        print("Opening Visual Settings...")
        page.get_by_test_id("reader-visual-settings-button").click()

        # 6. Check Layout Tabs
        print("Checking Layout Tabs...")
        # Wait for popover content
        expect(page.get_by_text("Ambience")).to_be_visible()

        paginated_tab = page.get_by_role("tab", name="Paginated")
        scrolled_tab = page.get_by_role("tab", name="Scrolled")

        # Take screenshot of the settings
        page.screenshot(path="/home/jules/verification/verification.png")
        print("Screenshot taken.")

        expect(paginated_tab).to_be_visible()
        expect(scrolled_tab).to_be_visible()

        # Check data-state
        paginated_state = paginated_tab.get_attribute("data-state")
        scrolled_state = scrolled_tab.get_attribute("data-state")

        print(f"Paginated state: {paginated_state}")
        print(f"Scrolled state: {scrolled_state}")

        if paginated_state == "active":
            print("SUCCESS: Paginated is active by default.")
        else:
            print("FAILURE: Paginated is NOT active.")

        browser.close()

if __name__ == "__main__":
    verify_layout_default()
