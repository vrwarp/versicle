import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_annotations_journey(page: Page):
    print("Starting Annotations Journey...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    page.get_by_test_id("book-card").click()
    expect(page.get_by_test_id("reader-back-button")).to_be_visible()

    # Wait for iframe content
    # Using more robust selector
    frame = page.locator('[data-testid="reader-iframe-container"] iframe').content_frame
    frame.locator("body").wait_for(timeout=2000)

    # 1. Create Highlight
    print("Creating Highlight...")

    # Navigate to a page with text (Next Page)
    page.get_by_test_id("reader-next-page").click()
    page.wait_for_timeout(2000)

    # Inject script to select text reliably
    selection_success = frame.locator("body").evaluate("""
        () => {
            try {
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
                    return true;
                }
                return false;
            } catch (e) {
                return false;
            }
        }
    """)

    if not selection_success:
        print("Could not select text for highlighting.")
        utils.capture_screenshot(page, "annotations_failed_selection")
        return

    # Check for Popover (using test id)
    expect(page.get_by_test_id("popover-color-yellow")).to_be_visible(timeout=2000)
    utils.capture_screenshot(page, "annotations_1_popover")

    # Click Yellow
    page.get_by_test_id("popover-color-yellow").click()
    expect(page.get_by_test_id("popover-color-yellow")).not_to_be_visible()

    # Verify in Sidebar
    print("Verifying Highlight in Sidebar...")
    page.get_by_test_id("reader-annotations-button").click()
    expect(page.get_by_test_id("reader-annotations-sidebar")).to_be_visible()

    # Check if any annotation item exists
    expect(page.locator("li[data-testid^='annotation-item-']").first).to_be_visible()
    utils.capture_screenshot(page, "annotations_2_sidebar_highlight")

    # Close sidebar
    page.get_by_test_id("reader-annotations-button").click()

    # 2. Create Note
    print("Creating Note...")
    # Select another text segment (offset)
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
                document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
            }
        }
    """)

    expect(page.get_by_test_id("popover-add-note-button")).to_be_visible()
    page.get_by_test_id("popover-add-note-button").click()

    # Fill Note
    page.get_by_test_id("popover-note-input").fill("My automated note")
    page.get_by_test_id("popover-save-note-button").click()

    # Verify Note in Sidebar
    print("Verifying Note in Sidebar...")
    page.get_by_test_id("reader-annotations-button").click()
    expect(page.get_by_test_id("annotation-note-text")).to_be_visible()
    expect(page.get_by_text("My automated note")).to_be_visible()
    utils.capture_screenshot(page, "annotations_3_sidebar_note")

    print("Annotations Journey Passed!")
