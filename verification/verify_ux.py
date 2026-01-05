from playwright.sync_api import sync_playwright

def verify_compass_pill():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to home
        page.goto("http://localhost:5173")
        page.wait_for_timeout(3000)

        # Check if empty state
        if page.get_by_text("Your library is empty").is_visible():
             print("Library is empty, loading demo book...")
             # Click "Load Demo Book (Alice in Wonderland)" button
             page.get_by_role("button", name="Load Demo Book").click()
             page.wait_for_timeout(5000) # Wait for import

        # Click on a book to open reader
        # Wait for book card to be visible
        print("Waiting for book card...")
        # Try waiting for the title "Alice" if .book-card is not the right class
        # Inspecting the code might reveal the class, but "Alice" text should be there.
        try:
            page.wait_for_selector("text=Alice", timeout=10000)
            page.get_by_text("Alice").first.click()
        except Exception as e:
            print(f"Could not find book: {e}")
            page.screenshot(path="verification/failed_find_book.png")
            raise e

        # Wait for reader to load
        page.wait_for_timeout(3000)

        # Take screenshot of the Reader View with Compass Pill
        page.screenshot(path="verification/compass_pill_verification.png")

        browser.close()

if __name__ == "__main__":
    verify_compass_pill()
