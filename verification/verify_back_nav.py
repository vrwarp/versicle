
from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to app (assuming it's running on 4173, need to start it first)
        page.goto('http://localhost:4173')

        # Initial screenshot
        page.screenshot(path='verification/1_initial.png')
        print('Initial screenshot taken')

        # Open Settings (Global)
        # Assuming there is a settings button or we can open it via state?
        # In LibraryView, there is a settings button in header?
        # Let's find it.
        settings_btn = page.locator('button[aria-label="Settings"]').first
        if settings_btn.is_visible():
            settings_btn.click()
            time.sleep(1) # Wait for animation
            page.screenshot(path='verification/2_settings_open.png')
            print('Settings opened')

            # Go Back
            page.go_back()
            time.sleep(1)
            page.screenshot(path='verification/3_settings_closed.png')
            print('Settings closed via Back')
        else:
            print('Settings button not found')

        browser.close()

if __name__ == '__main__':
    run()
