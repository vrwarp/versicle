import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_selection_popover_reappearance(page: Page):
    """
    Test that the selection popover appears correctly after multiple selections,
    specifically ensuring that adding a highlight doesn't break subsequent selection events.
    """
    print("Starting Selection Bug Verification...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    book_card = page.locator("[data-testid^='book-card-']").first
    # Wait for book card to be visible before clicking
    expect(book_card).to_be_visible(timeout=5000)
    book_card.click()

    expect(page.get_by_test_id("reader-back-button")).to_be_visible(timeout=5000)

    # Wait for iframe content
    frame = page.locator('[data-testid="reader-iframe-container"] iframe').content_frame
    frame.locator("body").wait_for(timeout=5000)

    # Navigate to next page to ensure text content
    page.get_by_test_id("reader-next-page").click()
    page.wait_for_timeout(2000)

    # 1. First Selection & Highlight
    print("Step 1: First Selection & Highlight")
    frame.locator("body").evaluate("""
        () => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
            let node = walker.nextNode();
            while(node) {
                if (node.textContent.trim().length > 10) {
                    break;
                }
                node = walker.nextNode();
            }

            if (node) {
                const range = document.createRange();
                range.setStart(node, 0);
                range.setEnd(node, 10);
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
        }
    """)

    # Expect popover to appear
    expect(page.get_by_test_id("popover-color-yellow")).to_be_visible(timeout=5000)

    # Click highlight (yellow)
    page.get_by_test_id("popover-color-yellow").click()
    expect(page.get_by_test_id("popover-color-yellow")).not_to_be_visible(timeout=5000)

    # 2. Second Selection (Different text)
    print("Step 2: Second Selection")
    # We select a different range to simulate a new user interaction
    frame.locator("body").evaluate("""
        () => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
            let node = walker.nextNode();
            while(node) {
                if (node.textContent.trim().length > 30) {
                    break;
                }
                node = walker.nextNode();
            }

            if (node) {
                const range = document.createRange();
                range.setStart(node, 15);
                range.setEnd(node, 25);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                document.dispatchEvent(new MouseEvent('mouseup', {
                    view: window,
                    bubbles: true,
                    cancelable: true,
                    clientX: 150,
                    clientY: 150
                }));
            }
        }
    """)

    # Expect popover to appear again
    # This was failing before the fix because epub.js listeners stopped firing
    expect(page.get_by_test_id("popover-color-yellow")).to_be_visible(timeout=5000)

    print("Selection Bug Verification Passed!")
