
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

        # Initial state screenshot
        page.screenshot(path='verification/1_library.png')
        print('Library screenshot taken')

        if settings_btn.count() > 0:
            settings_btn.first.click()
            time.sleep(1)
            page.screenshot(path='verification/2_settings_open.png')
            print('Settings opened')

            # Now test Back navigation
            page.go_back()
            time.sleep(1)
            page.screenshot(path='verification/3_settings_closed.png')
            print('Settings closed via Back')

            # Verify it is closed
            # Assuming dialog uses role='dialog' or check visibility
            dialog = page.locator('div[role="dialog"]')
            if dialog.count() == 0 or not dialog.first.is_visible():
                print('SUCCESS: Dialog closed')
            else:
                print('FAILURE: Dialog still visible')
        else:
            print('Settings button not found in LibraryView')

        browser.close()

if __name__ == '__main__':
    run()
