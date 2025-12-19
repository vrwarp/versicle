import pytest
from playwright.sync_api import Page, expect
from verification.utils import reset_app, capture_screenshot
import time
import re

def test_journey_flow_mode(page: Page):
    """
    User Journey: Flow Mode (Unified Input)
    Verifies that starting audio enters Listening State (overlay) and pausing returns to Visual Reading State.
    Also verifies Curtain Mode.
    """
    reset_app(page)

    # 1. Load Demo Book
    page.click("text=Load Demo Book (Alice in Wonderland)")
    expect(page.locator("text=Alice's Adventures in Wonderland")).to_be_visible(timeout=5000)

    # 2. Open Book
    page.click("text=Alice's Adventures in Wonderland")
    expect(page.locator("div[data-testid='reader-iframe-container']")).to_be_visible(timeout=5000)

    # 3. Enter Listening State (Start Audio via Header Button)
    # Open Audio Panel
    page.get_by_test_id("reader-audio-button").click()
    expect(page.get_by_test_id("tts-panel")).to_be_visible()

    # Click Play
    page.get_by_test_id("tts-play-pause-button").click()

    # Close Audio Panel (Click overlay/backdrop of sheet? Or press escape)
    page.keyboard.press("Escape")
    expect(page.get_by_test_id("tts-panel")).not_to_be_visible()

    # 4. Verify Overlay Appears (Listening State)
    # Check for the animated pulse border which signifies listening state
    expect(page.get_by_test_id("flow-mode-breathing-border")).to_be_visible(timeout=5000)
    capture_screenshot(page, "flow_mode_active")

    # Verify Text Dimming
    container = page.get_by_test_id("reader-iframe-container")
    expect(container).to_have_css("opacity", "0.85")

    # 5. Verify Curtain Mode
    viewport = page.viewport_size
    width = viewport['width'] if viewport else 1280
    height = viewport['height'] if viewport else 720
    center_x = width / 2
    center_y = height / 2

    # Double Tap to enable Curtain
    # Note: UnifiedInputController uses 300ms for double tap detection.
    # We click twice quickly.
    page.mouse.click(center_x, center_y)
    page.mouse.click(center_x, center_y)

    # Verify Curtain is active (black background)
    overlay = page.get_by_test_id("flow-mode-overlay")
    # Check if bg-black class is present. The class string contains 'bg-black'.
    expect(overlay).to_have_class(re.compile(r"bg-black"))
    expect(page.get_by_test_id("flow-mode-breathing-border")).not_to_be_visible()

    # 6. Verify Peek Mode
    # Single tap triggers Peek Mode
    # Wait a bit to ensure previous double tap is processed
    time.sleep(0.5)
    page.mouse.click(center_x, center_y)

    # Expect time and battery/text to be visible
    # We look for the time element which has text-6xl class, or just any text in the overlay
    # The overlay should now contain text.
    expect(overlay).to_contain_text(re.compile(r"\d+:\d+")) # Check for time format

    capture_screenshot(page, "flow_mode_curtain_peek")

    # 7. Disable Curtain Mode (Double Tap)
    # Wait for peek to potentially fade or just double tap through it
    time.sleep(0.5)
    page.mouse.click(center_x, center_y)
    page.mouse.click(center_x, center_y)

    expect(page.get_by_test_id("flow-mode-breathing-border")).to_be_visible()
    # Check that bg-transparent is back (or bg-black is gone)
    expect(overlay).not_to_have_class(re.compile(r"bg-black"))

    # 8. Stop Audio (via Center Tap on Overlay)
    # Wait a bit to ensure we don't trigger double tap from previous clicks
    time.sleep(0.5)
    page.mouse.click(center_x, center_y)

    # Verify Overlay Disappears (Visual Reading State)
    expect(page.get_by_test_id("flow-mode-breathing-border")).not_to_be_visible(timeout=5000)
    expect(container).to_have_css("opacity", "1")

    # 9. Take Screenshot
    capture_screenshot(page, "flow_mode_inactive")
