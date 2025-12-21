import pytest
from playwright.sync_api import Page, expect
from verification.utils import reset_app, get_reader_frame, capture_screenshot

def test_bug_click_text(page: Page):
    """
    Reproduction test for bug: Clicking on text goes backward.
    """
    reset_app(page)

    # 1. Load Book
    page.click("text=Load Demo Book (Alice in Wonderland)")
    expect(page.locator("text=Alice's Adventures in Wonderland")).to_be_visible(timeout=5000)
    page.click("text=Alice's Adventures in Wonderland")
    expect(page.locator("div[data-testid='reader-iframe-container']")).to_be_visible(timeout=5000)

    # Wait for content
    page.wait_for_timeout(3000)

    # Navigate to Chapter II (The Pool of Tears) to ensure we can go back
    print("Navigating to Chapter II...")
    page.get_by_test_id("reader-toc-button").click()
    expect(page.get_by_test_id("reader-toc-sidebar")).to_be_visible()

    # Click Chapter II
    try:
        page.get_by_text("The Pool of Tears", exact=False).click()
    except:
        # Fallback if text search fails or is ambiguous
        print("Fallback to toc-item-4")
        page.get_by_test_id("toc-item-4").click()

    # Wait for content
    page.wait_for_timeout(3000)

    # Get Reader Frame
    frame = get_reader_frame(page)
    assert frame, "Reader frame not found"

    # Verify we are on Chapter II
    # The text "The Pool of Tears" should be present.
    expect(frame.locator("body")).to_contain_text("Pool of Tears")

    # Locate a paragraph in the middle of the text
    # We'll just pick a paragraph that is likely in the view.
    # We can try to click the first paragraph.
    p_locator = frame.locator("p").nth(2) # 3rd paragraph

    # Scroll it into view if needed (though reader usually starts at top)
    p_locator.scroll_into_view_if_needed()

    # Get bounding box to ensure we are clicking on it
    box = p_locator.bounding_box()
    print(f"Paragraph box: {box}")

    # Click at 18% width of the iframe
    # Before fix (20%), this should navigate. After fix (15%), it should NOT navigate.
    iframe_el = page.locator("div[data-testid='reader-iframe-container'] iframe")
    box = iframe_el.bounding_box()
    assert box, "Iframe bounding box not found"

    click_x = box['x'] + (box['width'] * 0.18) # 18%
    click_y = box['y'] + (box['height'] * 0.5)

    print(f"Clicking at 18% width: {click_x}")
    page.mouse.click(click_x, click_y)

    # Wait a bit to see if navigation happens
    page.wait_for_timeout(2000)

    # Capture screenshot
    capture_screenshot(page, "bug_click_text_result")

    # Verify we are still on Chapter II
    frame = get_reader_frame(page) # Refresh frame handle
    content_text = frame.locator("body").inner_text()

    if "Pool of Tears" not in content_text and "Down the Rabbit-Hole" in content_text:
        pytest.fail("Bug reproduced: Navigation went backward after clicking text.")

    expect(frame.locator("body")).to_contain_text("Pool of Tears")
    print("Test passed: Stayed on Chapter II")
