from playwright.sync_api import sync_playwright

def verify_sync_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to app
        page.goto('http://localhost:5173')

        # Open Settings (assuming there is a settings button with specific aria-label or role)
        # Looking at GlobalSettingsDialog.tsx, it's a modal.
        # I need to find the trigger. Usually a gear icon or "Settings" button.
        # I'll guess it's a button with "Settings" aria-label or text.
        # Let's try to find a button with "Settings" aria-label or text.

        # Wait for app to load
        page.wait_for_timeout(3000)

        # Open settings
        # Trying a few common selectors
        try:
            page.get_by_role("button", name="Settings").click()
        except:
             # Try via aria-label if icon only
             page.locator("button[aria-label='Settings']").click()

        # Wait for modal
        page.wait_for_selector("text=Global Settings")

        # Click "Sync & Cloud" tab
        page.get_by_role("button", name="Sync & Cloud").click()

        # Verify content
        page.wait_for_selector("text=Cloud Synchronization")
        page.wait_for_selector("text=Data Recovery (Checkpoints)")

        # Take screenshot
        page.screenshot(path="verification/sync_settings.png")

        browser.close()

if __name__ == "__main__":
    verify_sync_ui()
