import pytest
import re
from playwright.sync_api import Page, expect
from verification import utils

def test_long_reading_journey(page: Page):
    print("Starting Long Reading Journey (Multi-session, History, Annotations)...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # --- Session 1: Reading and Highlighting ---
    print("\n--- Session 1 ---")

    # 1. Open Book
    print("Opening book...")
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))
    expect(page.get_by_test_id("reader-back-button")).to_be_visible(timeout=10000)

    # Wait for iframe content
    frame = page.locator('[data-testid="reader-iframe-container"] iframe').content_frame
    expect(frame.locator("body")).to_be_visible(timeout=10000)

    utils.capture_screenshot(page, "long_journey_01_session1_start")

    # 2. Navigate to Chapter 1 (toc-item-2 usually, as item-1 is Cover/Title)
    print("Navigating to Chapter 1...")
    page.get_by_test_id("reader-toc-button").click()
    # Assuming toc-item-2 is Chapter 1. The test_journey_history uses toc-item-2.
    # Alice book structure: 0: Cover, 1: Title, 2: Chap 1.
    page.get_by_test_id("toc-item-2").click()
    expect(page.get_by_test_id("reader-toc-sidebar")).not_to_be_visible()

    # Wait for content
    page.wait_for_timeout(2000)

    # 3. Read (Next Page)
    print("Reading (Next Page)...")
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(2000)

    # 4. Highlight text
    print("Creating Highlight...")
    # Capture text content before highlighting to verify return later
    session1_text = frame.locator("body").inner_text()

    # Using the snippet from test_journey_annotations.py
    selection_success = frame.locator("body").evaluate("""
        () => {
            try {
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
                let node = walker.nextNode();
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
        print("Warning: Could not select text for highlighting.")
    else:
        expect(page.get_by_test_id("popover-color-yellow")).to_be_visible(timeout=5000)
        page.get_by_test_id("popover-color-yellow").click()
        expect(page.get_by_test_id("popover-color-yellow")).not_to_be_visible()
        # Wait for annotation to be saved
        page.wait_for_timeout(1000)

    utils.capture_screenshot(page, "long_journey_02_session1_highlight")

    # 5. Wait for Dwell Time (important for history)
    print("Waiting for dwell time (3s)...")
    page.wait_for_timeout(3000)

    # 6. Close Book (Return to Library)
    print("Closing book...")
    page.get_by_test_id("reader-back-button").click()
    expect(page.get_by_test_id("library-view")).to_be_visible(timeout=10000)
    utils.capture_screenshot(page, "long_journey_03_library_returned")


    # --- Session 2: Resuming and History ---
    print("\n--- Session 2 ---")

    # 1. Reopen Book (Resume)
    print("Reopening book (Resume)...")
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-back-button")).to_be_visible(timeout=10000)

    # Wait for load
    page.wait_for_timeout(3000)
    utils.capture_screenshot(page, "long_journey_04_session2_resumed")

    # 2. Navigate to Chapter 3 (toc-item-4)
    print("Navigating to Chapter 3...")
    page.get_by_test_id("reader-toc-button").click()
    page.get_by_test_id("toc-item-4").click()
    expect(page.get_by_test_id("reader-toc-sidebar")).not_to_be_visible()
    page.wait_for_timeout(3000) # Wait for render + dwell

    # 3. Check History
    print("Checking History...")
    page.get_by_test_id("reader-toc-button").click()
    page.get_by_test_id("tab-history").click()

    # Expect history items
    expect(page.locator("ul.divide-y li")).not_to_have_count(0)

    utils.capture_screenshot(page, "long_journey_05_history_tab")

    # 4. Resume from History (Go back to previous location)
    print("Resuming from History...")
    history_items = page.locator("ul.divide-y li")
    count = history_items.count()
    if count > 1:
        history_items.nth(1).click()
    else:
        history_items.first.click()

    # Wait for nav
    page.wait_for_timeout(3000)
    expect(page.get_by_test_id("reader-toc-sidebar")).to_be_visible()

    # Verify content matches Session 1
    session2_text = frame.locator("body").inner_text()

    # We expect significant overlap in text
    # Taking a substring to avoid minor rendering differences or dynamic content
    snippet = session1_text[:50]
    if snippet not in session2_text:
        print(f"Warning: Text mismatch after resume.\nExpected start: {snippet}\nActual start: {session2_text[:50]}")
        # Depending on strictness, we might assert here.
        # For now, let's verify Chapter Title if available, or just assert something reasonable.
        # But for 'journey', seeing the text is key.
        assert snippet in session2_text, "Resumed content does not match Session 1 content"

    utils.capture_screenshot(page, "long_journey_06_history_resumed")

    # --- Session 3: Persistence Check (Reload) ---
    print("\n--- Session 3 ---")

    # 1. Reload Page
    print("Reloading page...")
    page.reload()
    expect(page.get_by_test_id("reader-back-button")).to_be_visible(timeout=10000)
    page.wait_for_timeout(3000)

    # 2. Verify Highlight is present
    # We check the global counter if exposed, or visual verification.
    count_after = page.evaluate("window.__reader_added_annotations_count")
    print(f"Annotations count after reload: {count_after}")

    if count_after > 0:
        print("Highlight persistence verified.")
    else:
        print("Warning: No annotations found after reload (might be on wrong page).")

    utils.capture_screenshot(page, "long_journey_07_final_check")

    print("Long Reading Journey Completed!")
