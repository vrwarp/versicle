import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_journey_annotations(page: Page):
    print("Starting Annotations Journey (Reload Verification)...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-back-button")).to_be_visible()

    # Wait for iframe content
    frame = page.locator('[data-testid="reader-iframe-container"] iframe').content_frame
    frame.locator("body").wait_for(timeout=5000)

    # 1. Create Highlight
    print("Creating Highlight...")

    # Navigate to a page with text (Next Page)
    page.get_by_test_id("reader-next-page").click()
    page.wait_for_timeout(2000)

    # Inject script to select text and trigger highlight popover
    selection_success = frame.locator("body").evaluate("""
        () => {
            try {
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
                let node = walker.nextNode();
                // Find a text node with enough length
                while(node) {
                    if (node.textContent.trim().length > 20) {
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
        pytest.fail("Could not select text for highlighting.")

    # Click Yellow Highlight
    expect(page.get_by_test_id("popover-color-yellow")).to_be_visible(timeout=3000)
    page.get_by_test_id("popover-color-yellow").click()
    expect(page.get_by_test_id("popover-color-yellow")).not_to_be_visible()

    # Verify logic via test helper exposed on window
    # Wait for annotations to be processed
    page.wait_for_timeout(1000)
    count = page.evaluate("window.__reader_added_annotations_count")
    print(f"Added annotations count before reload: {count}")
    assert count >= 1

    utils.capture_screenshot(page, "annotations_1_created")

    # 2. Reload Page
    print("Reloading page...")
    page.reload()

    # Wait for book to reload
    expect(page.get_by_test_id("reader-back-button")).to_be_visible(timeout=10000)
    frame = page.locator('[data-testid="reader-iframe-container"] iframe').content_frame
    frame.locator("body").wait_for(timeout=5000)

    # Wait for effect to run
    page.wait_for_timeout(2000)

    # 3. Verify Logic Persisted
    print("Verifying annotations reapplied after reload...")
    count_after = page.evaluate("window.__reader_added_annotations_count")
    print(f"Added annotations count after reload: {count_after}")
    assert count_after >= 1

    utils.capture_screenshot(page, "annotations_2_restored_after_reload")

    # 4. Verify Sidebar (sanity check)
    print("Verifying Sidebar...")
    page.get_by_test_id("reader-annotations-button").click()
    expect(page.get_by_test_id("reader-annotations-sidebar")).to_be_visible()
    expect(page.locator("li[data-testid^='annotation-item-']").first).to_be_visible()

    utils.capture_screenshot(page, "annotations_3_sidebar_check")

    print("Annotations Journey Passed!")
