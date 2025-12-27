
from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to app
        page.goto('http://localhost:4173')
        time.sleep(1)

        # We need to find where Global Settings can be opened.
        # It seems GlobalSettingsDialog is openable via ReaderView or LibraryView?
        # In LibraryView, there might be a settings button.

        # Let's take a screenshot of LibraryView to see what we have
        page.screenshot(path='verification/1_library.png')
        print('Library screenshot taken')

        # Try to find a settings button in LibraryView
        # Assuming there is one. If not, we might need to open a book first?
        # But Global Settings should be accessible from Library too?
        # Let's check LibraryView code or just look at screenshot.

        # If we can't find it, we can try to use keyboard shortcut or assume there is a button.
        # Let's try to find any button with aria-label 'Settings'
        settings_btn = page.locator('button[aria-label="Settings"]')
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

            # Verify it is closed (screenshot or locator)
            # Dialog usually has role='dialog'
            dialog = page.locator('div[role="dialog"]')
            if dialog.count() == 0 or not dialog.first.is_visible():
                print('SUCCESS: Dialog closed')
            else:
                print('FAILURE: Dialog still visible')
        else:
            print('Settings button not found in LibraryView')
            # Maybe it is in ReaderView?
            # We need a book to open ReaderView.
            # But verifying GlobalSettingsDialog in LibraryView is enough if we can open it.

        browser.close()

if __name__ == '__main__':
    run()
