import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_popover_edge_collision(page: Page):
    """
    Test that selecting text triggers the Annotation Mode in the fixed bottom bar (Compass Pill).
    The logic for "edge collision" is deprecated as the UI is now fixed at the bottom.
    This test ensures the new UI appears correctly upon selection.
    """
    print("Starting Selection Verification (formerly Edge Collision)...")

    # Set a mobile viewport
    page.set_viewport_size({"width": 375, "height": 812})

    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    book_card = page.locator("[data-testid^='book-card-']").first
    expect(book_card).to_be_visible(timeout=5000)
    book_card.click()

    expect(page.get_by_test_id("reader-back-button")).to_be_visible(timeout=5000)

    # Wait for iframe content
    frame = page.locator('[data-testid="reader-iframe-container"] iframe').content_frame
    frame.locator("body").wait_for(timeout=5000)

    # Wait for layout to stabilize
    page.wait_for_timeout(2000)

    print("Step 1: Selecting text")

    # Simulate a selection event
    frame.locator("body").evaluate("""
        () => {
             // Create a dummy element
             const dummy = document.createElement('span');
             dummy.innerText = "Selection Target";
             dummy.style.position = 'fixed';
             dummy.style.right = '0px';
             dummy.style.top = '100px';
             document.body.appendChild(dummy);

             const range = document.createRange();
             range.selectNodeContents(dummy);
             const selection = window.getSelection();
             selection.removeAllRanges();
             selection.addRange(range);

             document.dispatchEvent(new MouseEvent('mouseup', {
                 view: window,
                 bubbles: true,
                 cancelable: true,
                 clientX: 100,
                 clientY: 100
             }));
        }
    """)

    # Expect Compass Pill Annotation Mode to appear
    # The new UI replaces the floating popover with a fixed bar at the bottom
    annotation_pill = page.get_by_test_id("compass-pill-annotation")
    expect(annotation_pill).to_be_visible(timeout=5000)

    # Verify buttons exist in the bar
    expect(page.get_by_test_id("popover-copy-button")).to_be_visible()
    expect(page.get_by_test_id("popover-add-note-button")).to_be_visible()

    utils.capture_screenshot(page, "annotation_pill_visible")
    print("Selection Verification Passed!")
