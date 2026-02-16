from playwright.sync_api import sync_playwright, expect
import time

def verify_toast():
    with sync_playwright() as p:
        # Launch browser
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("Navigating to http://localhost:3000...")
        # Navigate to localhost
        page.goto("http://localhost:3000")

        # Wait for trigger button (custom added)
        print("Waiting for trigger button...")
        trigger_btn = page.locator("button[data-testid='trigger-toast']")
        try:
            trigger_btn.wait_for(timeout=20000)
        except:
            print("Trigger button not found. taking screenshot.")
            page.screenshot(path="verification/failure.png")
            browser.close()
            return

        # Click trigger
        print("Clicking trigger button...")
        trigger_btn.click()

        # Wait for toast
        print("Waiting for toast...")
        # We expect role='status' for info toast
        toast = page.get_by_role("status").filter(has_text="Test Toast Message")
        expect(toast).to_be_visible()

        # Screenshot initial state
        page.screenshot(path="verification/toast_visible.png")
        print("Toast visible screenshot taken: verification/toast_visible.png")

        # Hover to pause
        print("Hovering to pause...")
        toast.hover()

        # Wait longer than duration (5000ms set in hack)
        # If pause works, it should stay visible.
        # Wait 6s
        time.sleep(6)

        # Verify still visible
        expect(toast).to_be_visible()
        print("Toast still visible after hover (Paused).")

        # Screenshot paused state
        page.screenshot(path="verification/toast_paused.png")

        # Leave to unpause
        print("Leaving toast...")
        page.mouse.move(0, 0)

        # Wait for it to close. Duration restarts (5000ms).
        # Wait 6s
        time.sleep(6)

        # Verify hidden
        expect(toast).to_be_hidden()
        print("Toast hidden after leave.")

        browser.close()

if __name__ == "__main__":
    verify_toast()
