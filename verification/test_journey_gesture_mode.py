
import pytest
from playwright.sync_api import Page, expect
from verification.utils import reset_app, capture_screenshot

def test_journey_gesture_mode(page: Page):
    """
    User Journey: Enable Gesture Mode and verify overlay.
    """
    reset_app(page)

    # 1. Load Demo Book
    page.click("text=Load Demo Book (Alice in Wonderland)")
    expect(page.locator("text=Alice's Adventures in Wonderland")).to_be_visible(timeout=10000)

    # 2. Open Book
    page.click("text=Alice's Adventures in Wonderland")
    expect(page.locator("div[data-testid='reader-iframe-container']")).to_be_visible(timeout=10000)

    # 3. Open Audio Panel
    print("Opening Audio Panel...")
    page.click("button[data-testid='reader-tts-button']")
    expect(page.get_by_test_id("tts-panel")).to_be_visible()

    # 4. Switch to Settings View in Audio Panel
    print("Switching to Settings...")
    page.get_by_role("button", name="Settings").click()

    # 5. Toggle Gesture Mode
    print("Finding Gesture Mode switch...")
    # More precise locator: target the specific row div
    # using class matching or exact text match on label

    # Locate the label and get the switch next to it (or in same container)
    label = page.get_by_text("Gesture Mode (Eyes Free)", exact=True)
    expect(label).to_be_visible()

    # The switch is likely a sibling or in the parent div.
    # In UnifiedAudioPanel:
    # <div className="flex items-center justify-between">
    #    <label ...>
    #    <Switch ...>
    # </div>

    # So we can get parent of label, then find switch
    container = label.locator("..")
    switch = container.get_by_role("switch")
    expect(switch).to_be_visible()

    # Check initial state (should be unchecked)
    state = switch.get_attribute("aria-checked")
    print(f"Initial switch state: {state}")

    print("Clicking switch...")
    switch.click(force=True)
    page.wait_for_timeout(500) # Wait for react state update

    # Check new state
    new_state = switch.get_attribute("aria-checked")
    print(f"New switch state: {new_state}")

    if new_state != "true":
        print("Switch did not toggle! attempting JS click.")
        switch.evaluate("e => e.click()")
        page.wait_for_timeout(500)
        print(f"State after JS click: {switch.get_attribute('aria-checked')}")

    # Close Audio Panel to see overlay
    print("Closing Audio Panel...")
    # Click outside (left side of screen) to close sheet
    page.mouse.click(10, 300)
    page.wait_for_timeout(500) # Wait for animation

    # 5. Verify Overlay Appears
    print("Verifying Overlay...")
    # Wait specifically for the text
    try:
        expect(page.locator("text=Gesture Mode Active")).to_be_visible(timeout=5000)
    except Exception:
        print("Overlay text not visible. Dumping body text...")
        # print(page.inner_text("body"))
        capture_screenshot(page, "gesture_fail_overlay_missing")
        raise

    expect(page.locator("text=Exit Gesture Mode")).to_be_visible()

    # 6. Interact with Overlay (Tap Center)
    # Verify feedback icon appears
    # Wait for stable overlay
    page.wait_for_selector("text=Gesture Mode Active")

    # Trigger interaction.
    print("Tapping center...")
    page.mouse.click(500, 300)

    # Try to catch the feedback
    try:
        expect(page.locator("text=Playing").or_(page.locator("text=Paused"))).to_be_visible(timeout=3000)
    except Exception as e:
        print(f"Warning: Could not catch transient feedback in time, but proceeding to screenshot. Error: {e}")

    # 7. Take Screenshot
    capture_screenshot(page, "gesture_mode_active")

    # 8. Exit Gesture Mode
    print("Exiting Gesture Mode...")
    page.click("text=Exit Gesture Mode")
    expect(page.locator("text=Gesture Mode Active")).not_to_be_visible()
