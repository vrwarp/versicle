import re
import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_settings_persistence(page: Page):
    print("Starting Settings Persistence Journey...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    page.locator('[data-testid="book-card"]').click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))
    page.wait_for_timeout(2000)

    # 1. Open Global Settings
    print("Opening Global Settings...")
    page.get_by_test_id("reader-settings-button").click()

    # 2. Toggle Gesture Mode (Enable)
    print("Toggling Gesture Mode (Enable)...")
    gesture_switch = page.locator("button[role='switch']").first
    gesture_switch.click()
    page.wait_for_timeout(500)

    # Verify State (aria-checked)
    expect(gesture_switch).to_have_attribute("aria-checked", "true")

    utils.capture_screenshot(page, "settings_persistence_1_enabled")

    # Close Settings
    page.get_by_role("button", name="Close").click()

    # 3. Reload
    print("Reloading...")
    page.reload()
    page.wait_for_timeout(2000)

    # 4. Verify Persistence
    print("Verifying Persistence...")

    # Since Gesture Mode is active, the GestureOverlay blocks the ReaderSettings button.
    # However, GestureOverlay has an "Exit Gesture Mode" button (based on previous error log).
    # Let's verify that button exists, which confirms Gesture Mode persisted.

    exit_btn = page.locator("button", has_text="Exit Gesture Mode")
    # Or based on GestureOverlay.tsx (which I haven't read but saw in logs)

    expect(exit_btn).to_be_visible()

    utils.capture_screenshot(page, "settings_persistence_2_restored")

    # 5. Disable Gesture Mode to cleanup
    print("Disabling Gesture Mode via Overlay...")
    exit_btn.click()

    # Verify Overlay is gone
    expect(exit_btn).not_to_be_visible()

    # Now we can open settings and verify switch is off?
    # Wait, "Exit Gesture Mode" usually turns it off in the store?
    # Let's check ReaderView.tsx or GestureOverlay.tsx logic.
    # ReaderView: <GestureOverlay ... onClose={() => setGestureMode(false)} />
    # Yes, it turns it off.

    # Verify switch is now off in settings
    page.get_by_test_id("reader-settings-button").click()
    gesture_switch = page.locator("button[role='switch']").first
    expect(gesture_switch).to_have_attribute("aria-checked", "false")

    print("Settings Persistence Journey Passed!")
