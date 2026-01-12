
import time
from playwright.sync_api import sync_playwright, expect

def verify_book_action_menu():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use a new context to ensure clean state
        context = browser.new_context()
        page = context.new_page()

        try:
            # 1. Open the library page
            print("Navigating to Library...")
            page.goto("http://localhost:5173")

            # Wait for app to load
            page.wait_for_selector("body", state="attached")
            time.sleep(2) # Give it a moment to hydrate

            # 2. Check if we have books or need to upload one
            book_card = page.locator("[data-testid^='book-card-']").first

            if not book_card.is_visible():
                print("No books found. Attempting to upload 'alice.epub'...")
                # We target the file upload input in EmptyLibrary or FileUploader
                # Based on previous error, we have multiple file inputs.
                # The one in FileUploader (EmptyLibrary) is [data-testid="file-upload-input"]

                file_input = page.get_by_test_id("file-upload-input")

                if file_input.count() > 0 and file_input.is_visible(timeout=5000):
                    try:
                        file_input.set_input_files("verification/alice.epub")
                        print("File uploaded. Waiting for processing...")
                        # Wait for the book to appear
                        page.wait_for_selector("[data-testid^='book-card-']", timeout=15000)
                        book_card = page.locator("[data-testid^='book-card-']").first
                    except Exception as e:
                        print(f"Failed to upload book via main uploader: {e}")
                else:
                    print("Main file uploader not found or not visible.")

            if not book_card.is_visible():
                print("Still no book card visible. Cannot verify BookActionMenu.")
                page.screenshot(path="verification/failed_to_find_book.png")
                return

            print("Book card found.")

            # 3. Locate the Action Menu Trigger (the button)
            # It should have our new aria-label
            trigger = book_card.locator("button[aria-label='Book actions']")

            if not trigger.is_visible():
                # BookCover.tsx: "opacity-100 md:opacity-0 md:group-hover:opacity-100"
                # We need to hover the card
                print("Trigger not visible. Hovering card...")
                book_card.hover()
                trigger.wait_for(state="visible", timeout=2000)

            print("Clicking action menu trigger...")
            trigger.click()

            # 4. Wait for menu content
            menu_content = page.locator("[role='menu']")
            menu_content.wait_for(state="visible")

            print("Menu opened.")

            # 5. Take screenshot
            screenshot_path = "verification/book_action_menu_verified.png"
            page.screenshot(path=screenshot_path)
            print(f"Screenshot saved to {screenshot_path}")

        except Exception as e:
            print(f"Error during verification: {e}")
            page.screenshot(path="verification/error_state.png")
            raise e
        finally:
            browser.close()

if __name__ == "__main__":
    verify_book_action_menu()
