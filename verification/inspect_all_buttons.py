
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
        # Should be 2 buttons: one with aria-label='Preferences', one with text='Settings'
        print('Checking buttons...')
        all_btns = page.get_by_role("button").all()
        for btn in all_btns:
            txt = btn.inner_text()
            aria = btn.get_attribute('aria-label')
            if 'Settings' in txt or (aria and 'Settings' in aria) or (aria and 'Preferences' in aria):
                print(f"Button: text='{txt}' | aria-label='{aria}' | visible={btn.is_visible()}")

        browser.close()

if __name__ == '__main__':
    run()
