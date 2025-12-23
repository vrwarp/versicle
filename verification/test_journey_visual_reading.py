import pytest
from playwright.sync_api import Page, expect
from verification.utils import reset_app, get_reader_frame, capture_screenshot, navigate_to_chapter

def test_journey_visual_reading(page: Page):
    """
    User Journey: Visual Reading Interactions (Flow Mode)
    Verifies tap zones for page navigation and HUD toggling.
    Updated: Tap navigation is now restricted to Immersive Mode.
    """
    reset_app(page)

    # 1. Load Book
    page.click("text=Load Demo Book (Alice in Wonderland)")
    expect(page.locator("text=Alice's Adventures in Wonderland")).to_be_visible(timeout=5000)
    page.click("text=Alice's Adventures in Wonderland")
    expect(page.locator("div[data-testid='reader-iframe-container']")).to_be_visible(timeout=5000)

    # Wait for content
    page.wait_for_timeout(3000)

    # Navigate to Chapter 1 (Down the Rabbit-Hole) which is long and ensures multiple pages
    print("Navigating to Chapter I...")
    page.get_by_test_id("reader-toc-button").click()
    expect(page.get_by_test_id("reader-toc-sidebar")).to_be_visible()

    # Debug TOC and select "Chapter I"
    try:
        # Use loose match for Chapter I
        page.get_by_text("Chapter I", exact=False).first.click()
    except:
        print("Failed to click 'Chapter I' by text. Trying toc-item-2...")
        page.get_by_test_id("toc-item-2").click()

    # Wait for content after navigation (TOC closes automatically)
    page.wait_for_timeout(3000)

    # Get Reader Frame
    frame = get_reader_frame(page)
    assert frame, "Reader frame not found"

    # Wait for content
    try:
        frame.wait_for_selector("p", timeout=5000)
    except:
        pass

    # Get initial text
    initial_text = frame.locator("body").inner_text()
    print(f"Initial text length: {len(initial_text)}")

    # Determine tap targets based on Reader container (which might be centered max-w-2xl on desktop)
    reader_container = page.locator("div[data-testid='reader-iframe-container']")
    box = reader_container.bounding_box()
    assert box, "Reader container has no bounding box"

    reader_x = box['x']
    reader_y = box['y']
    reader_w = box['width']
    reader_h = box['height']

    print(f"Reader Box: x={reader_x}, y={reader_y}, w={reader_w}, h={reader_h}")

    # --- Test Issue B: Tap Navigation Disabled in Standard Mode ---
    print("Testing Standard Mode Tap Restriction...")
    # Right 10% of READER width
    tap_x_right = reader_x + (reader_w * 0.9)
    tap_y = reader_y + (reader_h / 2)

    page.mouse.click(tap_x_right, tap_y)

    # We verify that text does NOT change.
    # Waiting for timeout is necessary to ensure "absence" of change.
    # But we can try to wait for a short period and check.
    try:
        expect(frame.locator("body")).not_to_have_text(initial_text, timeout=2000)
        raise AssertionError("Tap navigation should be disabled in Standard Mode (Text Changed)")
    except AssertionError as e:
        if "Text Changed" in str(e):
            raise e
        # If timeout waiting for text change, it means text did NOT change (Success)
        pass

    print("Confirmed: Tap navigation disabled in Standard Mode")

    # --- Enter Immersive Mode ---
    print("Entering Immersive Mode...")
    page.get_by_test_id("reader-immersive-enter-button").click()
    expect(page.locator("header")).not_to_be_visible()

    # Verify Exit Button is visible
    expect(page.get_by_test_id("reader-immersive-exit-button")).to_be_visible()

    # Recalculate bounding box just in case
    reader_container = page.locator("div[data-testid='reader-iframe-container']")
    box = reader_container.bounding_box()
    reader_x = box['x']
    reader_y = box['y']
    reader_w = box['width']
    reader_h = box['height']
    tap_y = reader_y + (reader_h / 2)
    tap_x_right = reader_x + (reader_w * 0.9)
    tap_x_left = reader_x + (reader_w * 0.1)

    # Capture CFI before navigation
    cfi_before = page.evaluate("window.rendition && window.rendition.location && window.rendition.location.start ? window.rendition.location.start.cfi : 'null'")

    # --- Test Next Page (Right Tap) in Immersive Mode ---
    print("Tapping Right Zone (Immersive)...")
    # page.wait_for_timeout(1000) # Wait for UI to settle
    page.mouse.click(tap_x_right, tap_y)

    # Wait for CFI change
    # Manually poll for CFI change with wait_for_function
    try:
        page.wait_for_function(f"window.rendition && window.rendition.location && window.rendition.location.start && window.rendition.location.start.cfi !== '{cfi_before}'", timeout=5000)
    except:
        print("Failure: CFI did not change. Retrying tap...")
        page.mouse.click(tap_x_right, tap_y)
        page.wait_for_function(f"window.rendition && window.rendition.location && window.rendition.location.start && window.rendition.location.start.cfi !== '{cfi_before}'", timeout=5000)

    cfi_after = page.evaluate("window.rendition && window.rendition.location && window.rendition.location.start ? window.rendition.location.start.cfi : 'null'")

    # --- Test Prev Page (Left Tap) in Immersive Mode ---
    print(f"Tapping Left Zone (Immersive)...")
    # page.wait_for_timeout(1000)

    page.mouse.click(tap_x_left, tap_y)

    try:
        page.wait_for_function(f"window.rendition.location.start.cfi !== '{cfi_after}'", timeout=5000)
    except:
         print("Failure: CFI did not change on Prev. Retrying...")
         page.mouse.click(tap_x_left, tap_y)
         page.wait_for_function(f"window.rendition.location.start.cfi !== '{cfi_after}'", timeout=5000)

    cfi_prev = page.evaluate("window.rendition && window.rendition.location && window.rendition.location.start ? window.rendition.location.start.cfi : 'null'")

    # --- Test Center Tap (No Action/Exit) ---
    # Center tap is disabled in code.
    print("Tapping Center Zone...")
    tap_x_center = reader_x + (reader_w * 0.5)
    page.mouse.click(tap_x_center, tap_y)

    # Wait to ensure no exit
    page.wait_for_timeout(500)

    # Header should still be hidden (Center tap does NOT exit immersive mode anymore)
    expect(page.locator("header")).not_to_be_visible()

    capture_screenshot(page, "visual_reading_immersive_active")

    # --- Exit Immersive Mode ---
    print("Exiting Immersive Mode...")
    exit_btn = page.get_by_test_id("reader-immersive-exit-button")
    exit_btn.click()
    expect(page.locator("header")).to_be_visible()

    # Verify Exit Button is hidden
    expect(exit_btn).not_to_be_visible()

    print("Visual Reading Journey Passed!")
