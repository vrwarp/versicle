
from playwright.sync_api import sync_playwright
from verification import utils

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        utils.reset_app(page)
        utils.ensure_library_with_book(page)

        # Open Book
        print('Opening book...')
        page.locator("[data-testid^='book-card-']").first.click()
        page.get_by_test_id("reader-audio-button").click()

        # Check settings buttons
        settings_btns = page.get_by_role("button", name="Settings").all()
        print(f"Found {len(settings_btns)} Settings buttons")
        for i, btn in enumerate(settings_btns):
            print(f"Btn {i}: aria-label='{btn.get_attribute('aria-label')}' | text='{btn.inner_text()}' | visible={btn.is_visible()}")

        browser.close()

if __name__ == '__main__':
    run()
