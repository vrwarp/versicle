
import os
from playwright.sync_api import sync_playwright, expect
import time

def verify_repair_voice_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use a mobile viewport to match many existing tests and ensure responsiveness
        context = browser.new_context(viewport={"width": 375, "height": 667})
        page = context.new_page()

        try:
            # 1. Navigate to the app (assuming dev server is running on port 5173)
            page.goto("http://localhost:5173", timeout=10000)

            # Wait for app to load
            expect(page.get_by_role("heading", name="My Library")).to_be_visible(timeout=10000)

            # 2. Check for empty library and load demo book if needed
            load_demo = page.get_by_role("button", name="Load Demo Book")
            if load_demo.is_visible():
                print("Library is empty. Loading demo book...")
                load_demo.click()

                # Wait for book card to appear (indicates ingestion complete)
                print("Waiting for book card...")
                expect(page.locator("[data-testid^='book-card-']").first).to_be_visible(timeout=10000)

                # Now click the book card to open the reader
                print("Opening book...")
                page.locator("[data-testid^='book-card-']").first.click()

                # Wait for reader header which contains the settings button
                print("Waiting for reader settings button...")
                expect(page.get_by_test_id("reader-settings-button")).to_be_visible(timeout=20000)
            else:
                 # If library is not empty, we need to open a book.
                 print("Library has books. Opening first book...")
                 first_book = page.locator("[data-testid^='book-card-']").first
                 if first_book.is_visible():
                     first_book.click()
                     print("Waiting for reader settings button...")
                     expect(page.get_by_test_id("reader-settings-button")).to_be_visible(timeout=20000)
                 else:
                     raise Exception("No books found in library and 'Load Demo Book' not visible.")

            # 3. Open Global Settings
            print("Opening Global Settings...")
            page.get_by_test_id("reader-settings-button").click()

            # 4. Navigate to TTS tab in Global Settings
            # Wait for modal - Check for dialog role
            print("Waiting for Settings Dialog...")
            expect(page.get_by_role("dialog")).to_be_visible()

            # 5. Click "TTS Engine" tab
            print("Navigating to TTS Engine tab...")
            page.get_by_role("button", name="TTS Engine").click()

            # 6. Select Piper Provider
            print("Selecting Piper provider...")
            # Find the select for provider
            page.locator("button[role='combobox']").first.click()
            page.get_by_role("option", name="Piper (High Quality Local)").click()

            # 7. Select a Voice to show the UI
            print("Selecting a voice...")
            # We need to select a voice if one isn't selected.
            # Find the second combobox for voice
            page.locator("button[role='combobox']").nth(1).click()
            # Select first available voice
            page.locator("div[role='option']").first.click()

            # 8. Verify Repair Button Presence
            print("Verifying Repair button...")
            # We added a button with title "Force Repair / Clear Cache"
            repair_btn = page.locator("button[title='Force Repair / Clear Cache']")

            # Scroll to it if needed
            repair_btn.scroll_into_view_if_needed()

            expect(repair_btn).to_be_visible()

            # 9. Take Screenshot
            os.makedirs("verification", exist_ok=True)
            screenshot_path = "verification/piper_repair_ui.png"
            page.screenshot(path=screenshot_path)
            print(f"Screenshot saved to {screenshot_path}")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error_piper_repair.png")
            raise e
        finally:
            browser.close()

if __name__ == "__main__":
    verify_repair_voice_ui()
