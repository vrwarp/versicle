import pytest
from playwright.sync_api import Page, expect
from verification.utils import reset_app, capture_screenshot
import time

def test_journey_flow_mode(page: Page):
    """
    User Journey: Flow Mode (Unified Input)
    Verifies that starting audio enters Listening State (overlay) and pausing returns to Visual Reading State.
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

    # 5. Stop Audio (via Center Tap on Overlay)
    # The overlay covers the screen. Center tap pauses.
    viewport = page.viewport_size
    width = viewport['width'] if viewport else 1280
    height = viewport['height'] if viewport else 720

    page.mouse.click(width / 2, height / 2)

    # Verify Overlay Disappears (Visual Reading State)
    expect(page.get_by_test_id("flow-mode-breathing-border")).not_to_be_visible(timeout=5000)

    # 6. Take Screenshot
    capture_screenshot(page, "flow_mode_inactive")
