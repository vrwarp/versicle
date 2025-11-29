import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_tts_queue(page: Page):
    """
    Verifies that the TTS Queue UI is visible and populated.
    Navigates to a known chapter to ensure text is available.
    """
    print("Resetting app...")
    utils.reset_app(page)

    # Ensure book exists
    print("Ensuring book exists...")
    utils.ensure_library_with_book(page)

    # Click on the first book (Alice in Wonderland)
    print("Opening book...")
    page.get_by_test_id("book-card").click()

    # Wait for reader to load
    print("Waiting for reader...")
    expect(page.get_by_test_id("reader-iframe-container")).to_be_visible(timeout=2000)
    # Give some time for book and TOC to load
    page.wait_for_timeout(2000)

    # --- NEW NAVIGATION STEP ---
    print("Navigating to Chapter I via TOC to ensure text availability...")
    page.get_by_test_id("reader-toc-button").click()

    # Wait for TOC to open
    expect(page.get_by_test_id("reader-toc-sidebar")).to_be_visible(timeout=2000)

    # Click on 'Chapter I' or a known chapter.
    # Using specific TOC item test id if possible or locating by text within TOC sidebar
    # We added data-testid="toc-item-{index}" in ReaderView
    # Assuming Chapter I is at index 1 or so (Cover is 0 usually)
    # But to be safe, we can search by text inside the sidebar locators

    toc_sidebar = page.get_by_test_id("reader-toc-sidebar")
    toc_item = toc_sidebar.get_by_text("Chapter I").first

    if toc_item.count() == 0:
            print("Chapter I not found by text, using toc-item-1...")
            toc_item = page.get_by_test_id("toc-item-1")

    toc_text = toc_item.inner_text()
    print(f"Clicking TOC item: {toc_text}")
    toc_item.click()

    # Wait for TOC to close and page to render
    page.wait_for_timeout(2000) # Give epub.js time to render the new chapter

    # ---------------------------

    # 2. Open TTS Controls
    print("Opening TTS controls...")
    page.get_by_test_id("reader-tts-button").click()

    # Check for popup explicitly
    print("Waiting for TTS popup...")
    try:
        expect(page.get_by_test_id("tts-panel")).to_be_visible(timeout=2000)
    except Exception:
        print("Popup did not appear. Attempting click again...")
        page.get_by_test_id("reader-tts-button").click()
        expect(page.get_by_test_id("tts-panel")).to_be_visible(timeout=2000)

    # 3. Check for Queue
    print("Checking for Queue...")
    page.wait_for_timeout(2000) # Allow queue to populate

    # Check if queue container or no text message is visible
    queue_visible = page.get_by_test_id("tts-queue-container").is_visible()
    no_text_visible = page.get_by_text("No text available").is_visible()

    if not queue_visible and not no_text_visible:
         print("Neither Queue nor No text available found. Dumping page text:")
         print(page.inner_text("body"))
         utils.capture_screenshot(page, "tts_queue_fail_unknown")
         raise Exception("TTS Queue UI not found.")

    if no_text_visible:
        print("FAILURE: 'No text available' shown despite navigating to Chapter I.")
        utils.capture_screenshot(page, "tts_queue_fail_no_text")
        raise Exception("TTS Queue shows 'No text available' on a text-heavy page.")

    if queue_visible:
        print("Queue header found.")
        queue_items = page.locator("[data-testid^='tts-queue-item-']")

        # Wait for at least one item
        try:
             expect(queue_items.first).to_be_visible(timeout=2000)
        except:
             print("FAILURE: Queue header found but items not visible.")
             utils.capture_screenshot(page, "tts_queue_fail_empty")
             raise Exception("TTS Queue is empty.")

        count = queue_items.count()
        print(f"Found {count} queue items.")
        first_text = queue_items.first.text_content()
        print(f"First item: {first_text}")

    utils.capture_screenshot(page, "tts_queue_verification")

    # Additional check: Close TTS
    print("Closing TTS controls...")
    page.get_by_test_id("reader-tts-button").click()
    page.wait_for_timeout(500)

    utils.capture_screenshot(page, "tts_queue_closed")
    print("Test Passed: TTS Queue populated successfully.")
