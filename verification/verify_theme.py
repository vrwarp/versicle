
import time
from playwright.sync_api import sync_playwright

def verify_theme_settings():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            # Navigate to the app (assuming it's running on localhost:5173 based on vite default)
            page.goto("http://localhost:5173")

            # Wait for app to load
            page.wait_for_selector("body", state="visible")

            # Open Settings (assuming there's a button for it)
            # Based on memory/code, it might be in a header or menu.
            # I'll check for a button with 'settings' in text or aria-label.
            # In GlobalSettingsDialog.tsx, it's controlled by useUIStore.
            # I need to trigger opening it. usually there is a settings button in the header.

            # Let's try to find a settings button.
            # If I look at the sidebar or header...
            # The prompt memory mentions 'header-settings-button'.

            settings_btn = page.locator("[data-testid='header-settings-button']")
            if settings_btn.count() > 0:
                settings_btn.click()
            else:
                # Fallback: try finding by text or icon
                page.get_by_role("button", name="Settings").click()

            # Wait for dialog to open
            page.wait_for_selector("text=Settings", state="visible")
            page.wait_for_selector("text=General", state="visible")

            # Check for Appearance section
            page.wait_for_selector("text=Appearance", state="visible")
            page.wait_for_selector("text=Theme", state="visible")

            # Select Theme dropdown
            # It's a Radix UI Select, so we might need to find the trigger.
            # The label is "Theme", so the trigger should be nearby or associated.
            # In shadcn/ui select, the trigger usually has role="combobox".

            # Let's find the select trigger relative to "Theme" label
            # or just look for the combobox with "Light" (default)

            # Take a screenshot of the General settings with Theme option
            page.screenshot(path="verification/settings_theme.png")
            print("Screenshot taken: verification/settings_theme.png")

            # Try changing theme to Dark
            page.click("button[role='combobox']:has-text('Light')")
            page.click("div[role='option']:has-text('Dark')")

            # Wait a bit for theme application
            time.sleep(1)

            # Take screenshot of dark mode
            page.screenshot(path="verification/settings_theme_dark.png")
            print("Screenshot taken: verification/settings_theme_dark.png")

            # Verify body/root has class 'dark'
            html_class = page.eval_on_selector("html", "el => el.className")
            if "dark" in html_class:
                print("Theme successfully changed to Dark")
            else:
                print(f"Theme change failed. html classes: {html_class}")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_theme_settings()
