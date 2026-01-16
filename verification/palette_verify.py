from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()
    try:
        page.goto("http://localhost:5173", timeout=30000)

        # Wait for search input with longer timeout
        search_input = page.get_by_test_id("library-search-input")
        expect(search_input).to_be_visible(timeout=30000)

        # Verify attributes
        type_attr = search_input.get_attribute("type")
        label_attr = search_input.get_attribute("aria-label")

        print(f"Search Input Type: {type_attr}")
        print(f"Search Input Aria-Label: {label_attr}")

        assert type_attr == "search"
        assert label_attr == "Search library"

        # Take screenshot
        page.screenshot(path="verification/palette_verify.png")
    except Exception as e:
        print(f"Error: {e}")
        page.screenshot(path="verification/palette_error.png")
        raise e
    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)
