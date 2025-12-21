import pytest
from playwright.sync_api import Page, expect
from verification.utils import reset_app, get_reader_frame, capture_screenshot, navigate_to_chapter

def test_journey_visual_reading(page: Page):
    """
    User Journey: Visual Reading Interactions (Flow Mode)
    Verifies tap zones for page navigation and HUD toggling constraints.
    """
    reset_app(page)

    # 1. Load Book
    page.click("text=Load Demo Book (Alice in Wonderland)")
    expect(page.locator("text=Alice's Adventures in Wonderland")).to_be_visible(timeout=5000)
    page.click("text=Alice's Adventures in Wonderland")
    expect(page.locator("div[data-testid='reader-iframe-container']")).to_be_visible(timeout=5000)

    # Wait for content
    page.wait_for_timeout(3000)

    # Navigate to Chapter 1
    print("Navigating to Chapter I...")
    page.get_by_test_id("reader-toc-button").click()
    expect(page.get_by_test_id("reader-toc-sidebar")).to_be_visible()
    try:
        page.get_by_text("Chapter I", exact=False).first.click()
    except:
        page.get_by_test_id("toc-item-2").click()
    page.wait_for_timeout(3000)

    frame = get_reader_frame(page)
    assert frame, "Reader frame not found"
    try:
        frame.wait_for_selector("p", timeout=5000)
    except:
        pass

    initial_text = frame.locator("body").inner_text()

    # Get Bounds
    reader_container = page.locator("div[data-testid='reader-iframe-container']")
    box = reader_container.bounding_box()
    rx, ry, rw, rh = box['x'], box['y'], box['width'], box['height']

    # --- Test 1: Standard Mode (Should NOT Navigate) ---
    print("Testing Standard Mode: Tapping should NOT navigate...")

    # Right Tap
    tap_x = rx + (rw * 0.9)
    tap_y = ry + (rh / 2)
    page.mouse.click(tap_x, tap_y)
    page.wait_for_timeout(2000)

    frame = get_reader_frame(page)
    text_std = frame.locator("body").inner_text()
    assert initial_text == text_std, "Page navigated in Standard Mode!"

    # --- Test 2: Immersive Mode (Should Navigate) ---
    print("Entering Immersive Mode...")
    page.get_by_test_id("reader-immersive-enter-button").click()
    expect(page.locator("header")).not_to_be_visible()
    page.wait_for_timeout(1000)

    # Re-calc bounds
    box = reader_container.bounding_box()
    rx, ry, rw, rh = box['x'], box['y'], box['width'], box['height']

    # Right Tap (Next)
    print("Tapping Right Zone (Next)...")
    tap_x = rx + (rw * 0.9)
    tap_y = ry + (rh / 2)
    page.mouse.click(tap_x, tap_y)
    page.wait_for_timeout(3000)

    frame = get_reader_frame(page)
    text_next = frame.locator("body").inner_text()

    if text_std == text_next:
         print("Warning: Text did not change. Trying again...")
         page.mouse.click(tap_x, tap_y)
         page.wait_for_timeout(3000)
         frame = get_reader_frame(page)
         text_next = frame.locator("body").inner_text()

    assert text_std != text_next, "Page did not turn in Immersive Mode"

    # Left Tap (Prev)
    print("Tapping Left Zone (Prev)...")
    tap_x = rx + (rw * 0.1)
    page.mouse.click(tap_x, tap_y)
    page.wait_for_timeout(3000)

    frame = get_reader_frame(page)
    text_prev = frame.locator("body").inner_text()
    assert text_prev != text_next, "Page did not turn back"

    # Center Tap (Should NOT exit immersive mode via tap, button required)
    print("Tapping Center Zone...")
    tap_x = rx + (rw * 0.5)
    page.mouse.click(tap_x, tap_y)
    page.wait_for_timeout(1000)
    expect(page.locator("header")).not_to_be_visible()

    # Exit Immersive Mode via Button
    print("Exiting Immersive Mode...")
    page.get_by_test_id("reader-immersive-exit-button").click()
    expect(page.locator("header")).to_be_visible()

    capture_screenshot(page, "visual_reading_passed")
    print("Visual Reading Journey Passed!")
