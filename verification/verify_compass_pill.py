import sys
from playwright.sync_api import sync_playwright

def verify_compact_pill():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        page.goto('http://localhost:4173')

        # Initial Load
        page.wait_for_selector('body', timeout=10000)

        # Load Demo Book if available
        if page.get_by_text('Load Demo Book').count() > 0:
            print('Loading demo book...')
            page.get_by_text('Load Demo Book').click()
            page.wait_for_timeout(3000)

        # Navigate to Reader
        try:
             page.wait_for_selector('.group.relative.flex-col', timeout=5000)
             print('Clicking book card...')
             page.locator('.group.relative.flex-col').first.click()
        except:
             print('No book card found, might be already in reader or loading failed')

        # Wait for Reader
        try:
            page.wait_for_selector('.epub-container', timeout=15000)
            print('In Reader View')
        except:
            print('Failed to enter Reader View')
            page.screenshot(path='verification/failed_entry.png')
            return

        # Toggle Immersive Mode
        # The reader view has a 'reader-immersive-enter-button' (Maximize icon)
        try:
             print('Clicking Immersive Mode button...')
             # Using the data-testid we saw in ReaderView.tsx
             page.locator('button[data-testid="reader-immersive-enter-button"]').click()
             print('Entered Immersive Mode')
        except Exception as e:
             print(f'Could not enter immersive mode via UI: {e}')

        page.wait_for_timeout(2000)

        # Check if we see the compact pill
        # It has data-testid="compass-pill-compact"
        if page.locator('[data-testid="compass-pill-compact"]').is_visible():
             print('Compact Pill Visible')
        else:
             print('Compact Pill NOT Visible')

        page.screenshot(path='verification/compact_pill.png')
        print('Done')
        browser.close()

if __name__ == '__main__':
    verify_compact_pill()
