from playwright.sync_api import sync_playwright, expect

def test_search_interaction():
    with sync_playwright() as p:
        print("Launching browser...")
        browser = p.chromium.launch(headless=True, args=['--ignore-certificate-errors'])
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()

        # Listen to console logs
        page.on("console", lambda msg: print(f"Browser console: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"Browser error: {exc}"))

        print("Navigating to Library...")
        try:
            page.goto("https://localhost:5173/", timeout=60000)
        except Exception as e:
            print(f"Navigation failed: {e}")
            page.goto("https://localhost:5173/", timeout=60000)

        # Wait for the library to load.
        try:
            page.wait_for_selector('h1:has-text("My Library"), h1:has-text("Critical Error"), div:has-text("Service Worker failed")', timeout=60000)
        except Exception:
            print("Timeout waiting for content. Dumping page content...")
            page.screenshot(path="verification/timeout.png")
            raise

        # Check for errors
        if page.locator('text=Service Worker failed').is_visible():
            print("Service Worker failed to initialize.")
            page.screenshot(path="verification/sw_failure.png")
            return

        if page.locator('text=Critical Error').is_visible():
            print("App hit a critical error.")
            page.screenshot(path="verification/app_error.png")
            return

        # Find the search input
        search_input = page.get_by_label("Search library")
        expect(search_input).to_be_visible()

        print("Typing search query 'test'...")
        search_input.fill("test")

        # Verify Clear button appears
        clear_button = page.get_by_label("Clear search")
        expect(clear_button).to_be_visible()

        # Take a screenshot with the clear button
        print("Taking screenshot of search with clear button...")
        page.screenshot(path="verification/search_with_input.png")

        # Verify status message
        # We target the one that is sr-only to disambiguate from SyncPulseIndicator
        status_region = page.locator('div[role="status"].sr-only')
        expect(status_region).to_contain_text("No books found")

        print("Status region text verified: ", status_region.inner_text())

        # Now check if we can click "Clear search" safely (simulating the failure)
        # This should fail if there are two buttons matching "Clear search"
        try:
            print("Attempting to click 'Clear search' button...")
            page.get_by_role("button", name="Clear search").click()
            print("Clicked successfully (Unexpected if ambiguous)")
        except Exception as e:
            print(f"Click failed as expected (Ambiguity check): {e}")

        # Verify input is cleared
        expect(search_input).to_have_value("")

        # Verify Clear button disappears
        expect(clear_button).not_to_be_visible()

        print("Taking screenshot after clearing...")
        page.screenshot(path="verification/search_cleared.png")

        browser.close()

if __name__ == "__main__":
    test_search_interaction()
