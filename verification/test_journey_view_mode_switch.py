import pytest
from playwright.sync_api import Page, expect
from verification.utils import reset_app, capture_screenshot
import time

def test_journey_view_mode_switch(page: Page):
    """
    User Journey: View Mode Switching
    Verifies that switching between Paginated and Scrolled modes does not crash the reader.
    """
    reset_app(page)

    # 1. Load Demo Book
    page.click("text=Load Demo Book (Alice in Wonderland)")
    expect(page.locator("text=Alice's Adventures in Wonderland")).to_be_visible(timeout=5000)

    # 2. Open Book
    page.click("text=Alice's Adventures in Wonderland")
    expect(page.locator("div[data-testid='reader-iframe-container']")).to_be_visible(timeout=10000)

    # Wait for initial render of iframe content
    frame = page.frame_locator("iframe").first
    expect(frame.locator("body")).to_be_visible(timeout=10000)

    # 3. Open Visual Settings
    page.get_by_test_id("reader-visual-settings-button").click()
    expect(page.locator("text=Layout")).to_be_visible()

    # 4. Switch to Scrolled
    # Use text selector or role for TabsTrigger
    page.click("button[role='tab']:has-text('Scrolled')")

    # Wait for potential reload/crash
    time.sleep(3)

    # Verify still alive
    expect(page.locator("div[data-testid='reader-iframe-container']")).to_be_visible()

    # Verify we are in scrolled mode (can check if iframe has style or class, or if we can scroll)
    # The component doesn't expose easy test id for mode, but we can assume if it didn't crash it's good.

    # 5. Switch to Paginated
    page.click("button[role='tab']:has-text('Paginated')")
    time.sleep(3)

    # Verify still alive
    expect(page.locator("div[data-testid='reader-iframe-container']")).to_be_visible()

    # 6. Switch back to Scrolled again
    page.click("button[role='tab']:has-text('Scrolled')")
    time.sleep(3)

    # Verify still alive
    expect(page.locator("div[data-testid='reader-iframe-container']")).to_be_visible()

    capture_screenshot(page, "view_mode_switch_success")
