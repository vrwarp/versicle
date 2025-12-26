from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()

    # Assuming the app is running on localhost:5173
    try:
        page.goto("http://localhost:5173")

        # Wait for the library view to load
        page.wait_for_selector('[data-testid="library-view"]')

        # Take a screenshot of the grid view
        page.screenshot(path="verification/library_grid_view.png")
        print("Screenshot saved to verification/library_grid_view.png")

        # Toggle to list view if the button exists
        toggle_btn = page.query_selector('[data-testid="view-toggle-button"]')
        if toggle_btn:
            toggle_btn.click()
            # Wait a bit for layout to settle
            page.wait_for_timeout(500)
            page.screenshot(path="verification/library_list_view.png")
            print("Screenshot saved to verification/library_list_view.png")

    except Exception as e:
        print(f"Error: {e}")
    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)
