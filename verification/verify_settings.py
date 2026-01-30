from playwright.sync_api import Page, expect, sync_playwright
import time

def verify_settings_dialog(page: Page):
    print("Navigating to app...")
    page.goto("http://localhost:5173", timeout=60000)

    # Check for Critical Error
    try:
        print("Checking for critical error...")
        error_locator = page.get_by_text("Critical Error")
        if error_locator.is_visible(timeout=5000):
            print("Critical Error found. Clicking Reload...")
            page.get_by_role("button", name="Reload").click()
            time.sleep(2)
    except Exception:
        print("No critical error found immediately.")

    # Wait for the app to load
    print("Waiting for app to load...")
    try:
        page.wait_for_selector('text=My Library', timeout=30000)
    except Exception:
        print("My Library not found. checking for error again.")
        if page.get_by_text("Critical Error").is_visible():
             print("Critical Error persists.")
             page.screenshot(path="verification/persist_error.png")
             raise Exception("App failed to load due to Service Worker error")
        else:
             page.screenshot(path="verification/unknown_state.png")
             raise

    # Open Settings
    print("Opening Settings...")
    # Using aria-label as it's more robust/user-facing than test-id
    settings_btn = page.get_by_role("button", name="Settings")
    settings_btn.click()

    # Assert Dialog is open
    print("Verifying dialog...")
    dialog = page.get_by_role("dialog")
    expect(dialog).to_be_visible()

    # 1. Capture General Tab (Theme)
    print("Capturing General Tab...")
    # Should be default, but let's click to be sure
    if page.get_by_role("button", name="General").is_visible():
         page.get_by_role("button", name="General").click()
    page.wait_for_timeout(1000) # Wait for animation
    page.screenshot(path="verification/settings_general.png")

    # 2. Capture TTS Tab (Sliders)
    print("Capturing TTS Tab...")
    page.get_by_role("button", name="TTS Engine").click()
    page.wait_for_timeout(1000) # Wait for animation

    page.screenshot(path="verification/settings_tts.png")
    print("Screenshots captured.")

if __name__ == "__main__":
    with sync_playwright() as p:
        print("Launching browser...")
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_settings_dialog(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()
