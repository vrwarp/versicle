import time
from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    # We need to simulate a context with local storage access
    context = browser.new_context()
    page = context.new_page()

    # Assuming the dev server is running on port 5173
    try:
        page.goto("http://localhost:5173")
    except Exception as e:
        print(f"Failed to load page: {e}")
        browser.close()
        return

    # Wait for the app to load
    page.wait_for_load_state("networkidle")

    # We need to inject a book if the library is empty.
    # Or we can use the "Load Demo Book" button if visible.

    # Check if empty state is present
    try:
        if page.get_by_text("Your library is empty").is_visible():
            print("Library is empty. Loading demo book...")
            page.get_by_role("button", name="Load Demo Book").click()
            # Wait for book to appear
            page.wait_for_selector('[data-testid^="book-card-"]', timeout=10000)
    except Exception as e:
        print(f"Error handling empty state: {e}")

    # Now we expect to see a book card.
    # We want to see the progress bar.
    # The progress bar only shows if progress > 0.

    # We need to simulate reading progress.
    # We can try to modify the local storage or IDB, but that's complex.
    # Alternatively, we can just screenshot the card as is.
    # But to verify the progress bar, we need progress.

    # Let's open the book, scroll a bit, and close it?
    # Or just inject data into indexedDB?

    # Let's try to inject data directly into the component via console if possible? No.

    # Simpler: Just verify the card renders correctly.
    # If we can't easily force progress > 0 without a complex script,
    # we might just settle for seeing the card without progress,
    # OR we can try to click the book, wait for it to load, scroll, and go back.

    print("Taking screenshot of library...")
    page.screenshot(path="verification/library_view.png")

    # Let's try to open the book to generate some progress
    # Click the first book
    page.click('[data-testid^="book-card-"]')

    # Wait for reader to load
    time.sleep(5) # Give it some time to load/render

    # Scroll/Simulate progress
    # page.keyboard.press("PageDown")
    # time.sleep(1)

    # Go back to library (Browser Back)
    page.go_back()
    time.sleep(2)

    # Take another screenshot
    page.screenshot(path="verification/library_view_after_read.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
