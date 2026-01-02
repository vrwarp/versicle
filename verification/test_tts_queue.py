import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_tts_queue(page: Page):
    """
    Verifies that the TTS Queue UI is visible and populated.
    Uses Next Page navigation to find text if initial page is empty.
    """
    print("Resetting app...")
    utils.reset_app(page)

    # Ensure book exists
    print("Ensuring book exists...")
    utils.ensure_library_with_book(page)

    # Click on the first book (Alice in Wonderland)
    print("Opening book...")
    page.locator("[data-testid^='book-card-']").first.click()

    # Wait for reader to load
    print("Waiting for reader...")
    expect(page.get_by_test_id("reader-iframe-container")).to_be_visible(timeout=2000)
    page.wait_for_timeout(2000)

    # Open TTS Controls
    print("Opening TTS controls...")
    page.get_by_test_id("reader-audio-button").click()

    # Wait for popup
    try:
        expect(page.get_by_test_id("tts-panel")).to_be_visible(timeout=2000)
    except:
        page.get_by_test_id("reader-audio-button").click()
        expect(page.get_by_test_id("tts-panel")).to_be_visible(timeout=2000)

    # Search for text by paging forward
    found_text = False
    max_pages = 5

    for i in range(max_pages):
        print(f"Checking page {i+1} for text...")
        page.wait_for_timeout(2000)

        # Check queue status
        queue_items = page.locator("[data-testid^='tts-queue-item-']")
        count = queue_items.count()

        if count > 0:
            print(f"Found {count} queue items.")
            found_text = True
            break

        print("Queue empty. Navigating to next page...")
        # Close TTS panel to allow navigation (avoid focus trap)
        page.get_by_test_id("reader-audio-button").click()
        try:
            expect(page.get_by_test_id("tts-panel")).not_to_be_visible(timeout=2000)
        except:
            # Retry if click failed
            page.get_by_test_id("reader-audio-button").click()
            expect(page.get_by_test_id("tts-panel")).not_to_be_visible(timeout=2000)

        # Navigate
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(2000)

        # Re-open TTS panel
        page.get_by_test_id("reader-audio-button").click()
        expect(page.get_by_test_id("tts-panel")).to_be_visible(timeout=2000)

    if not found_text:
        # One last check
        if page.locator("[data-testid^='tts-queue-item-']").count() > 0:
            print("Found items on last attempt.")
        else:
            print("FAILURE: Could not find text after paging.")
            utils.capture_screenshot(page, "tts_queue_fail_paging")
            raise Exception("TTS Queue failed to populate after navigating through pages.")

    # Verify content
    first_item = page.locator("[data-testid^='tts-queue-item-']").first
    print(f"First item text: {first_item.text_content()}")

    utils.capture_screenshot(page, "tts_queue_verification")

    print("Test Passed: TTS Queue populated successfully.")
