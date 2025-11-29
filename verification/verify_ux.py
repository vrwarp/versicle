
import os
import time
from playwright.sync_api import sync_playwright, expect

def verify_ux_refinements():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Capture console logs
        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"PAGE ERROR: {exc}"))

        try:
            # 1. Verify Library Empty State
            print("Navigating to Library...")
            page.goto("http://localhost:5173")

            # Wait for empty state
            expect(page.get_by_text("No books yet")).to_be_visible(timeout=10000)
            page.screenshot(path="verification/1_library_empty.png")
            print("Screenshot 1: Library Empty State captured.")

            # 2. Verify Import and Toast
            print("Importing book...")
            # Set input files directly, bypassing file chooser dialog interception if it's tricky
            page.set_input_files("input[type='file']", "verification/alice.epub")

            # Wait for book card
            expect(page.get_by_test_id("book-card")).to_be_visible(timeout=20000)
            print("Book card visible.")

            # 3. Verify Reader Loading State (Spinner)
            print("Opening book...")
            page.get_by_test_id("book-card").click()

            # Wait for Reader View
            expect(page.get_by_test_id("reader-iframe-container")).to_be_visible(timeout=15000)
            page.screenshot(path="verification/3_reader_view.png")
            print("Screenshot 3: Reader View captured.")

            # 4. Verify Search Empty State
            print("Opening Search...")
            page.get_by_test_id("reader-search-button").click()
            expect(page.get_by_placeholder("Search in book...")).to_be_visible()

            # Search for nonsense
            # Search might be async and take time for index to be ready or worker to respond.
            # searchClient.indexBook is async.
            # We see "Book indexed for search" in console.

            page.get_by_placeholder("Search in book...").fill("supercalifragilistic")
            page.get_by_placeholder("Search in book...").press("Enter")

            # Wait for result
            expect(page.get_by_text('No results found for "supercalifragilistic"')).to_be_visible(timeout=10000)
            page.screenshot(path="verification/4_search_empty.png")
            print("Screenshot 4: Search Empty State captured.")

            # 5. Verify Annotations Empty State
            print("Opening Annotations...")
            page.get_by_test_id("reader-annotations-button").click()
            expect(page.get_by_text("No annotations yet")).to_be_visible()
            page.screenshot(path="verification/5_annotations_empty.png")
            print("Screenshot 5: Annotations Empty State captured.")

        except Exception as e:
            print(f"Verification failed: {e}")
            page.screenshot(path="verification/failure.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_ux_refinements()
