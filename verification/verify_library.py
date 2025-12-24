from playwright.sync_api import sync_playwright

def verify_library_view():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            # Navigate to the app (assuming default vite port 5173)
            page.goto("http://localhost:5173")

            # Wait for library view to load
            page.wait_for_selector('[data-testid="library-view"]', timeout=10000)

            # Check for the grid
            # Note: With no books, it might show empty state.
            # We can at least check that the empty state renders or if we can mock adding a book.
            # Ideally, we'd see the grid if there were books.
            # Let's take a screenshot of the initial state.
            page.screenshot(path="verification/library_view.png")
            print("Screenshot saved to verification/library_view.png")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_library_view()
