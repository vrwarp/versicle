from playwright.sync_api import Page, expect, sync_playwright
import os

def verify_settings_accessibility(page: Page):
    print("Navigating to app...")
    page.goto("http://localhost:5173/")

    print("Waiting for settings button...")
    settings_btn = page.locator('button[data-testid="header-settings-button"]')
    settings_btn.wait_for(timeout=60000)
    print("Clicking settings button...")
    settings_btn.click()

    print("Waiting for modal...")
    page.get_by_role("heading", name="Global Settings").wait_for()

    print("Switching to TTS tab...")
    page.get_by_role("button", name="TTS Engine").click()

    # 5. Verify Active Provider Label
    print("Verifying Active Provider label...")
    provider_label = page.locator("label").filter(has_text="Active Provider").first
    provider_trigger = page.locator("button[data-testid='tts-provider-select']")

    # Ensure closed initially
    expect(provider_trigger).to_have_attribute("aria-expanded", "false")

    print("Clicking Active Provider label...")
    provider_label.click()

    # Assert menu opened (aria-expanded="true") or focus moved to option
    print("Checking if menu expanded...")
    expect(provider_trigger).to_have_attribute("aria-expanded", "true")

    # Close it to reset state for next test
    page.keyboard.press("Escape")
    expect(provider_trigger).to_have_attribute("aria-expanded", "false")

    # 6. Verify Mode Label
    print("Verifying Mode label...")
    mode_label = page.locator("label").filter(has_text="Mode").first
    mode_trigger = page.locator("#tts-mode-select")

    expect(mode_trigger).to_have_attribute("aria-expanded", "false")
    mode_label.click()
    print("Checking if mode menu expanded...")
    expect(mode_trigger).to_have_attribute("aria-expanded", "true")

    # 7. Take screenshot
    print("Taking screenshot...")
    page.screenshot(path="verification/settings_labels.png")
    print("Verification passed! Screenshot saved.")

if __name__ == "__main__":
    os.makedirs("verification", exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_settings_accessibility(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error_state.png")
            raise e
        finally:
            browser.close()
