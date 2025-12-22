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
    page.wait_for_timeout(2000) # Short wait

    # Get new text
    frame = get_reader_frame(page)
    text_after_tap_standard = frame.locator("body").inner_text()

    # Should match initial text (No navigation)
    assert initial_text == text_after_tap_standard, "Tap navigation should be disabled in Standard Mode"
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
    page.wait_for_timeout(1000) # Wait for UI to settle
    page.mouse.click(tap_x_right, tap_y)
    page.wait_for_timeout(3000) # Wait for page turn animation/render

    cfi_after = page.evaluate("window.rendition && window.rendition.location && window.rendition.location.start ? window.rendition.location.start.cfi : 'null'")

    # Re-fetch frame as it might be detached/replaced
    frame = get_reader_frame(page)
    assert frame, "Reader frame lost after navigation"

    # Get new text
    new_text = frame.locator("body").inner_text()
    print(f"New text length: {len(new_text)}")

    # Assert changed
    if initial_text == new_text:
        # Text might be unchanged in paginated mode (CSS columns), so we rely on CFI check
        if cfi_before and cfi_after and cfi_before == cfi_after:
            print("Failure: CFI did not change. Retrying tap...")
            page.mouse.click(tap_x_right, tap_y)
            page.wait_for_timeout(3000)
            cfi_after = page.evaluate("window.rendition && window.rendition.location && window.rendition.location.start ? window.rendition.location.start.cfi : 'null'")

            if cfi_before == cfi_after:
                # Last resort manual next check to confirm engine isn't completely frozen
                page.evaluate("window.rendition.next()")
                page.wait_for_timeout(3000)
                assert cfi_before != cfi_after, f"Page did not turn after retry. CFI remained {cfi_before}"

    # --- Test Prev Page (Left Tap) in Immersive Mode ---
    print(f"Tapping Left Zone (Immersive)...")
    page.wait_for_timeout(1000)

    page.mouse.click(tap_x_left, tap_y)
    page.wait_for_timeout(3000)

    cfi_prev = page.evaluate("window.rendition && window.rendition.location && window.rendition.location.start ? window.rendition.location.start.cfi : 'null'")

    if cfi_prev == cfi_after:
         print("Failure: CFI did not change on Prev. Retrying...")
         page.mouse.click(tap_x_left, tap_y)
         page.wait_for_timeout(3000)
         cfi_prev = page.evaluate("window.rendition && window.rendition.location && window.rendition.location.start ? window.rendition.location.start.cfi : 'null'")

         assert cfi_prev != cfi_after, f"Page did not turn back. CFI remained {cfi_after}"

    # --- Test Center Tap (No Action/Exit) ---
    # Center tap is disabled in code.
    print("Tapping Center Zone...")
    tap_x_center = reader_x + (reader_w * 0.5)
    page.mouse.click(tap_x_center, tap_y)
    page.wait_for_timeout(1000)

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
