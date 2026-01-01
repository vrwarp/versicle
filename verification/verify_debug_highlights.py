
import time
from playwright.sync_api import sync_playwright, expect

def verify_debug_highlights():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        try:
            # 1. Load the app
            print("Navigating to app...")
            page.goto("http://localhost:5173")

            # Wait for library to load
            try:
                page.wait_for_selector('text=Your library is empty', timeout=10000)
                print("Library empty. Need to upload a book.")
                # We need a book. Since we can't easily upload one in this environment without a file,
                # we might be stuck if there are no books.
                # However, the environment usually has some sample or persistent state?
                # If "Your library is empty", we must upload.
                # I'll create a dummy epub or try to find one.
                # For now, let's assume we can't easily verify if empty.
            except:
                print("Library not empty or timed out waiting for empty message.")

            # If we see a book, click it.
            # Look for a book cover or title.
            # Assuming there is a book card.
            try:
                page.wait_for_selector('[data-testid^="book-card-"]', timeout=5000)
                print("Found book card. Clicking...")
                page.click('[data-testid^="book-card-"]')
            except:
                print("No book card found. Cannot proceed with reader verification.")
                return

            # Wait for reader to load
            page.wait_for_selector('[data-testid="reader-view"]', timeout=15000)
            print("Reader view loaded.")

            # 2. Enable Debug Mode
            # Open Global Settings
            page.click('[data-testid="reader-settings-button"]')
            page.wait_for_selector('text=Settings', timeout=5000)

            # Find Debug Mode toggle. It might be in "Advanced" or just in the list.
            # I need to know where "Debug Mode" is.
            # Based on `ReaderView.tsx`, `isDebugModeEnabled` comes from `useGenAIStore`.
            # I suspect there is a switch in GlobalSettingsDialog.
            # I'll search for text "Debug Mode" or "Content Analysis Debug".

            # Assuming it's visible or scrolling needed.
            if page.get_by_text("Debug Mode").is_visible():
                page.get_by_text("Debug Mode").click()
                print("Toggled Debug Mode.")
            else:
                print("Debug Mode toggle not found in settings.")

            # Close settings
            page.keyboard.press("Escape")

            # 3. Wait for highlights
            # We need to wait for `dbService.getContentAnalysis` to return and highlights to be applied.
            # This might take a moment.
            time.sleep(3)

            # Take screenshot
            page.screenshot(path="verification/debug_highlights.png")
            print("Screenshot saved to verification/debug_highlights.png")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_debug_highlights()
