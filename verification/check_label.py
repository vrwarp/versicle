
from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to app
        page.goto('http://localhost:4173')
        time.sleep(1)

        # In LibraryView, find button with testid 'header-settings-button'
        settings_btn = page.locator('button[data-testid="header-settings-button"]')

        if settings_btn.count() > 0:
            print(f"Settings button aria-label: {settings_btn.first.get_attribute('aria-label')}")
        else:
            print('Settings button not found')

        browser.close()

if __name__ == '__main__':
    run()
