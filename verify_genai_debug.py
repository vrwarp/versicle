
import time
from playwright.sync_api import sync_playwright

def verify_genai_settings():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the app (assuming it's running on localhost:5173 based on vite default)
        page.goto("http://localhost:5173")

        # Wait for app to load - check for settings button OR empty state
        time.sleep(5)

        # Trying a broader selector
        try:
             # Wait for button that opens settings.
             # In LibraryView, the header usually has a settings button.
             page.wait_for_selector('[data-testid="header-settings-button"]', timeout=5000)
             page.get_by_testid("header-settings-button").click()
        except:
             # Fallback: maybe we are in reader view? (unlikely on root)
             try:
                 page.wait_for_selector('[data-testid="reader-settings-button"]', timeout=5000)
                 page.get_by_testid("reader-settings-button").click()
             except:
                 print("Could not find settings button. Dumping page.")
                 print(page.content())
                 return

        # Wait for modal
        page.wait_for_selector('[role="dialog"]', state="visible")

        # Click GenAI Tab
        page.get_by_role("button", name="Generative AI").click()

        # Enable GenAI first to see other options
        page.get_by_label("Enable AI Features").check()

        # Enable Content Analysis to see debug option
        page.get_by_label("Content Type Detection & Filtering").check()

        # Check if debug mode switch exists and is interactable
        debug_switch = page.locator("#genai-debug")
        if debug_switch.count() > 0:
            print("Debug switch found.")
            debug_switch.check()
            time.sleep(0.5)
            if debug_switch.is_checked():
                print("Debug switch checked.")
            else:
                print("Debug switch failed to check.")
        else:
            print("Debug switch not found.")

        # Take screenshot of the GenAI settings with debug option
        time.sleep(1) # Wait for animation
        page.screenshot(path="genai_settings_debug.png")

        print("Screenshot saved to genai_settings_debug.png")

        browser.close()

if __name__ == "__main__":
    verify_genai_settings()
