import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_popover_edge_collision(page: Page):
    """
    Test that the selection popover stays within the viewport even when selecting text
    near the right edge of the screen.
    """
    print("Starting Popover Edge Verification...")

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

    print("Step 1: Selecting text near the right edge")

    # We will attempt to find a text node that is close to the right edge and select it.
    # We use evaluate to run logic inside the browser/iframe context.
    frame.locator("body").evaluate("""
        () => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
            let node = walker.nextNode();
            let found = false;

            while(node) {
                // Check each character/word position roughly
                const range = document.createRange();
                range.selectNodeContents(node);
                const rects = range.getClientRects();

                for (let i = 0; i < rects.length; i++) {
                    const rect = rects[i];
                    // If the text is within 50px of the right edge (window.innerWidth)
                    if (rect.right > window.innerWidth - 50 && rect.right < window.innerWidth) {
                        // Select this range
                        const selection = window.getSelection();
                        selection.removeAllRanges();
                        selection.addRange(range);

                        // Dispatch mouseup to trigger the popover logic in ReaderView
                        document.dispatchEvent(new MouseEvent('mouseup', {
                            view: window,
                            bubbles: true,
                            cancelable: true,
                            clientX: rect.left,
                            clientY: rect.top
                        }));
                        found = true;
                        break;
                    }
                }
                if (found) break;
                node = walker.nextNode();
            }

            if (!found) {
                console.log("Could not find text near right edge automatically. Mocking a selection event at the edge.");
                // Mocking event if no text is found (fallback)
                // This simulates the ReaderView receiving a selection event where the range rect is near the edge.
                // However, ReaderView calls range.getBoundingClientRect().
                // So we need to fake a range or force a selection that returns such a rect.
                // Creating a dummy element at the edge might be easier.

                const dummy = document.createElement('span');
                dummy.innerText = "Edge";
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
                    clientX: window.innerWidth - 10,
                    clientY: 100
                }));
            }
        }
    """)

    # Expect popover to appear
    popover_container = page.locator(".bg-white.shadow-xl").first
    # The class selector is based on AnnotationPopover.tsx: "bg-white dark:bg-gray-800 shadow-xl ..."
    # Or use a known child to find the parent
    popover_button = page.get_by_test_id("popover-copy-button")
    expect(popover_button).to_be_visible(timeout=5000)

    # Check bounds
    # We need the bounding box of the popover container
    # Since we can't easily select the container by test-id (it doesn't have one on the outer div),
    # we use xpath from a child.
    popover_div = popover_button.locator("xpath=..")

    box = popover_div.bounding_box()
    print(f"Popover Box: {box}")

    viewport = page.viewport_size
    print(f"Viewport: {viewport}")

    # Assert right edge is within viewport
    # allow a small margin of error (e.g. scrollbar or rounding)
    assert box['x'] + box['width'] <= viewport['width'] + 2, f"Popover extends beyond viewport! Right edge: {box['x'] + box['width']}, Viewport width: {viewport['width']}"
    assert box['x'] >= 0, "Popover is off-screen to the left!"

    utils.capture_screenshot(page, "popover_edge_check")
    print("Popover Edge Verification Passed!")
