from playwright.sync_api import Page, expect, sync_playwright
import time

def test_data_management_ux(page: Page):
    # Listen to console logs
    page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.text}"))
    page.on("pageerror", lambda err: print(f"BROWSER ERROR: {err}"))

    print("Navigating to app...")
    # 1. Arrange: Go to the app.
    page.goto("http://localhost:5173")

    # Wait a bit for initial load
    time.sleep(2)

    # Reload to ensure SW is ready/DB connects (common fix for this environment)
    print("Reloading page...")
    page.reload()

    print("Opening settings...")
    # 2. Act: Open settings.
    # Wait for the button to be visible with longer timeout
    settings_btn = page.get_by_test_id("header-settings-button")
    try:
        expect(settings_btn).to_be_visible(timeout=30000)
    except Exception as e:
        print("Settings button not found. Dumping HTML...")
        # print(page.content())
        raise e

    settings_btn.click()

    print("Navigating to Data Management tab...")
    # 3. Act: Navigate to Data Management tab.
    # The tab button text is "Data Management"
    data_tab = page.get_by_role("button", name="Data Management")
    expect(data_tab).to_be_visible()
    data_tab.click()

    print("Verifying Clear All Data button...")
    # 4. Assert: Check for "Clear All Data" button.
    clear_btn = page.get_by_role("button", name="Clear All Data")
    expect(clear_btn).to_be_visible()
    expect(clear_btn).not_to_be_disabled()

    print("Verifying aria-labels...")
    # 5. Assert: Check for aria-labels on file inputs.
    csv_input = page.locator('input[data-testid="reading-list-csv-input"]')
    expect(csv_input).to_have_attribute("aria-label", "Upload CSV")

    backup_input = page.locator('input[data-testid="backup-file-input"]')
    expect(backup_input).to_have_attribute("aria-label", "Restore Backup")

    print("Taking screenshot...")
    # 6. Screenshot
    page.screenshot(path="verification/verification.png")
    print("Verification complete.")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # No ignore_https_errors needed now
        page = browser.new_page()
        try:
            test_data_management_ux(page)
        except Exception as e:
            print(f"Test failed: {e}")
            page.screenshot(path="verification/error.png")
            raise e
        finally:
            browser.close()
