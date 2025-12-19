import pytest
from playwright.sync_api import Page, expect
from verification.utils import reset_app, get_reader_frame, capture_screenshot, navigate_to_chapter

def test_journey_visual_reading(page: Page):
    """
    User Journey: Visual Reading Interactions (Flow Mode)
    Verifies tap zones for page navigation and HUD toggling.
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

    # --- Test Next Page (Right Tap) ---
    print("Tapping Right Zone...")
    # Right 10% of READER width
    tap_x_right = reader_x + (reader_w * 0.9)
    tap_y = reader_y + (reader_h / 2)

    page.mouse.click(tap_x_right, tap_y)
    page.wait_for_timeout(3000) # Wait for page turn animation/render

    # Re-fetch frame as it might be detached/replaced
    frame = get_reader_frame(page)
    assert frame, "Reader frame lost after navigation"

    # Get new text
    new_text = frame.locator("body").inner_text()
    print(f"New text length: {len(new_text)}")

    # Assert changed
    if initial_text == new_text:
        print("Warning: Text did not change. Trying again...")
        page.mouse.click(tap_x_right, tap_y)
        page.wait_for_timeout(3000)
        frame = get_reader_frame(page)
        new_text = frame.locator("body").inner_text()

    assert initial_text != new_text, "Page did not turn (text unchanged)"

    # --- Test Prev Page (Left Tap) ---
    print("Tapping Left Zone...")
    # Left 10% of READER width
    tap_x_left = reader_x + (reader_w * 0.1)

    page.mouse.click(tap_x_left, tap_y)
    page.wait_for_timeout(3000)

    # Re-fetch frame
    frame = get_reader_frame(page)
    assert frame, "Reader frame lost after prev navigation"

    prev_text = frame.locator("body").inner_text()
    assert prev_text != new_text, "Page did not turn back"

    # --- Test Toggle HUD (Center Tap) ---
    # HUD is currently visible (default)
    expect(page.locator("header")).to_be_visible()

    print("Tapping Center Zone...")
    tap_x_center = reader_x + (reader_w * 0.5)
    page.mouse.click(tap_x_center, tap_y)

    # HUD should REMAIN visible (Behavior change: Center tap disabled)
    expect(page.locator("header")).to_be_visible(timeout=3000)

    capture_screenshot(page, "visual_reading_immersive_disabled")

    print("Visual Reading Journey Passed!")
