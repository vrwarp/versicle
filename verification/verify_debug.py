from playwright.sync_api import Page, expect, sync_playwright
import time

def verify_export_debug_button(page: Page):
    # 1. Arrange: Go to the app
    page.goto("http://localhost:5173")

    # Wait for the app to load
    page.wait_for_load_state("networkidle")

    # 2. Act: Open Settings
    settings_button = page.get_by_label("Settings").first
    settings_button.click()

    # 3. Assert: Settings dialog is open
    dialog = page.get_by_role("dialog")
    expect(dialog).to_be_visible()

    # 4. Act: Click on Data Management tab
    data_tab = page.get_by_role("button", name="Data Management")
    data_tab.click()

    # 5. Assert: Export Debug Info button is visible
    # We might need to scroll the content area.
    # The content area has class overflow-y-auto
    # We can try to scroll the button into view
    export_button = page.get_by_role("button", name="Export Debug Info")
    export_button.scroll_into_view_if_needed()
    expect(export_button).to_be_visible()

    # 6. Screenshot
    time.sleep(0.5) # ensure scroll settles
    page.screenshot(path="verification/debug_settings_full.png")
    print("Screenshot taken: verification/debug_settings_full.png")

if __name__ == "__main__":
  with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    try:
      verify_export_debug_button(page)
    except Exception as e:
      print(f"Error: {e}")
      page.screenshot(path="verification/error.png")
    finally:
      browser.close()
