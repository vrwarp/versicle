
import os
import sys
from playwright.sync_api import sync_playwright, expect

def verify_gesture_overlay():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Using a mobile viewport to match expected use case for gestures
        context = browser.new_context(viewport={"width": 375, "height": 667})
        page = context.new_page()

        # 1. Load the app
        page.goto("http://localhost:5173/")

        # 2. Check for empty library and load demo book
        try:
            # Wait for either the book card or the load demo button
            # We use a short timeout for the book card because it might not be there
            page.wait_for_selector('[data-testid="book-card"]', timeout=3000)
            print("Book found in library.")
        except:
            print("Library empty, loading demo book...")
            # Click "Load Demo Book (Alice in Wonderland)"
            # Text might be split, so let's use a substring locator
            page.get_by_text("Load Demo Book").click()

            # Wait for the book to appear
            page.wait_for_selector('[data-testid="book-card"]', timeout=10000)
            print("Demo book loaded.")

        # 3. Open the book
        page.get_by_test_id("book-card").first.click()

        # 4. Wait for Reader to load
        expect(page.get_by_test_id("reader-iframe-container")).to_be_visible(timeout=10000)

        # 5. Enable Gesture Mode
        # The switch was found in GlobalSettingsDialog.tsx but NOT UnifiedAudioPanel.tsx in my memory,
        # but my memory said "Gesture Mode toggle has been moved from `GlobalSettingsDialog.tsx` to `UnifiedAudioPanel.tsx`".
        # However, grep on UnifiedAudioPanel.tsx returned nothing for "Gesture Mode".
        # Grep on GlobalSettingsDialog.tsx returned match.
        # So it seems it is in GlobalSettingsDialog.tsx.

        # Open Settings
        page.get_by_test_id("reader-settings-button").click()

        # Default tab is 'general' which contains "Gesture Mode"
        # Wait for "Gesture Mode" text
        page.wait_for_selector('text="Gesture Mode"', timeout=2000)

        # Click the switch next to it.
        # The structure is: <div>Gesture Mode</div>...<Switch/>
        # We can click the switch by label? Or just the switch.
        # Since text is "Gesture Mode", we can try to click the switch relative to it.
        # Or just click the text if the label is clickable? No, standard Switch.

        # Let's find the toggle.
        # We can toggle it by clicking the switch role.
        # There might be multiple switches.
        # Use layout selector.

        # Or just click the text "Gesture Mode" and then find the nearest switch?
        # Playwright: page.get_by_role("switch").click() if it's the only one.
        # In 'general' tab, it seems to be the only one visible?
        # Let's try.

        page.get_by_role("switch").click()

        # Close the modal
        # Dialog component (Modal) usually has a close button or we can press escape.
        page.keyboard.press("Escape")

        # Wait a bit for animation
        page.wait_for_timeout(500)

        # 6. Verify Overlay Text Visibility
        # The overlay text "Gesture Mode Active" should be visible.
        expect(page.get_by_text("Gesture Mode Active")).to_be_visible(timeout=5000)

        # 7. Take screenshot
        os.makedirs("verification", exist_ok=True)
        screenshot_path = "verification/gesture_mode_active.png"
        page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to {screenshot_path}")

        browser.close()

if __name__ == "__main__":
    verify_gesture_overlay()
