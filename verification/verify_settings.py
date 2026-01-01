
import time
from playwright.sync_api import sync_playwright, expect

def verify_settings(page):
    # Wait for the app to load
    page.goto("http://localhost:5173")

    # Wait for the app to be ready (e.g. check for a known element)
    # The app might have an empty state or a library view.
    # Let's wait for the settings button in the header.
    # Looking at the code, there should be a settings button with data-testid="header-settings-button"

    settings_btn = page.locator('[data-testid="header-settings-button"]')
    settings_btn.wait_for(state="visible", timeout=10000)
    settings_btn.click()

    # Now in settings dialog.
    # We need to go to "Generative AI" tab.
    # The tabs are buttons.
    page.get_by_role("button", name="Generative AI").click()

    # Check if "Enable AI Features" switch is there.
    # We need to enable it to see the content analysis options.
    enable_ai_switch = page.locator("label[for='genai-toggle']")
    # Or just find the switch itself.

    # Let's toggle the switch if it's off.
    # The switch component usually has role="switch".
    # We need to find the one associated with "Enable AI Features".
    # The label has 'for="genai-toggle"'.

    ai_switch = page.locator("#genai-toggle")
    if not ai_switch.is_checked():
        ai_switch.click()

    # Now we need to enable "Content Type Detection & Filtering" if not enabled.
    content_detection_switch = page.locator("#genai-content-detection")
    if not content_detection_switch.is_checked():
        content_detection_switch.click()

    # Now we should see the checkboxes.
    # Check for "footnote" label.
    expect(page.get_by_label("footnote")).to_be_visible()

    # Check for "citation" label - should NOT be visible.
    expect(page.get_by_label("citation")).not_to_be_visible()

    # Check for "Clear Content Analysis Cache" button.
    clear_cache_btn = page.get_by_role("button", name="Clear Content Analysis Cache")
    expect(clear_cache_btn).to_be_visible()

    # Take screenshot
    page.screenshot(path="verification/verification.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_settings(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()
