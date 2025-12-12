from playwright.sync_api import Page, expect, sync_playwright
import os
import time

def verify_reader(page: Page):
    # 1. Go to home
    print("Navigating to home...")
    page.goto("http://localhost:5173")

    # 2. Upload book if library is empty
    # We need absolute path for file upload
    current_dir = os.getcwd()
    book_path = os.path.join(current_dir, "public/books/alice.epub")

    if not os.path.exists(book_path):
        print(f"Book not found at {book_path}")
        return

    print("Uploading book...")
    # The file input is hidden but attached
    page.set_input_files('input[type="file"]', book_path)

    # 3. Wait for book card
    print("Waiting for book card...")
    try:
        page.wait_for_selector('text=Alice\'s Adventures in Wonderland', timeout=10000)
    except:
        print("Book card not found? Taking screenshot.")
        page.screenshot(path="/home/jules/verification/library_error.png")
        raise

    # 4. Click the book
    print("Opening book...")
    page.click('text=Alice\'s Adventures in Wonderland')

    # 5. Wait for ReaderView
    print("Waiting for ReaderView...")
    page.wait_for_selector('div[data-testid="reader-iframe-container"]', timeout=20000)

    # Wait a bit for epub content to load inside iframe (optional for just verifying app shell)
    time.sleep(2)

    # 6. Screenshot
    print("Taking screenshot...")
    page.screenshot(path="/home/jules/verification/reader_view.png")

if __name__ == "__main__":
    if not os.path.exists("/home/jules/verification"):
        os.makedirs("/home/jules/verification")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_reader(page)
            print("Verification successful")
        except Exception as e:
            print(f"Verification failed: {e}")
            # Ensure we capture error state
            try:
                page.screenshot(path="/home/jules/verification/error.png")
            except:
                pass
        finally:
            browser.close()
