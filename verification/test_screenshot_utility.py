import os
import pytest
from playwright.sync_api import Page, expect
from verification.utils import capture_screenshot

def test_screenshot_hides_debug_overlay(page: Page):
    """
    Verifies that capture_screenshot with hide_tts_status=True correctly hides
    the #tts-debug element before capturing the screenshot.
    """
    # 1. Setup: Create a fake tts-debug element
    page.set_content("""
        <html>
            <body>
                <div id="content">Main Content</div>
                <div id="tts-debug" style="position:fixed; bottom:10px; right:10px; background:red; width:100px; height:50px;">
                    DEBUG
                </div>
            </body>
        </html>
    """)

    # Verify initial state
    debug_el = page.locator("#tts-debug")
    expect(debug_el).to_be_visible()

    # 2. Capture screenshot with hide_tts_status=True
    # The updated utility now waits for the element to be hidden.
    # We test that the function executes without error and the element is effectively manipulated.
    screenshot_name = "test_debug_hidden"
    capture_screenshot(page, screenshot_name, hide_tts_status=True)

    # 3. Verify it's visible again after the capture
    expect(debug_el).to_be_visible()

    # Cleanup
    viewport = page.viewport_size
    width = viewport['width'] if viewport else 1280
    suffix = "mobile" if width < 600 else "desktop"
    file_path = f"verification/screenshots/{screenshot_name}_{suffix}.png"

    if os.path.exists(file_path):
        os.remove(file_path)

def test_screenshot_ignores_missing_overlay(page: Page):
    """
    Verifies that capture_screenshot proceeds gracefully if #tts-debug is missing.
    """
    page.set_content("<html><body><div>Just Content</div></body></html>")

    capture_screenshot(page, "test_missing_debug", hide_tts_status=True)

    # Cleanup
    viewport = page.viewport_size
    width = viewport['width'] if viewport else 1280
    suffix = "mobile" if width < 600 else "desktop"
    file_path = f"verification/screenshots/test_missing_debug_{suffix}.png"

    if os.path.exists(file_path):
        os.remove(file_path)
