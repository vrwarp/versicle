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
    # Wait for book to appear
    page.wait_for_selector('text=Alice\'s Adventures in Wonderland', timeout=2000)
    page.click('text=Alice\'s Adventures in Wonderland')

    # Wait for reader to load
    print("Waiting for reader...")
    page.wait_for_selector('iframe', timeout=2000)

    # --- NEW NAVIGATION STEP ---
    print("Navigating to Chapter I via TOC to ensure text availability...")
    page.click('button[aria-label="Table of Contents"]')
    # Wait for TOC to open
    page.wait_for_selector('text=Contents', timeout=2000)

    # Click on 'Chapter I' or a known chapter.
    toc_item = page.locator("button").filter(has_text="Chapter I").first

    # Fallback if specific text not found (resilient testing)
    if toc_item.count() == 0:
            print("Chapter I not found by text, using nth(1)...")
            toc_item = page.locator("ul.space-y-2 li button").nth(1)

    toc_text = toc_item.inner_text()
    print(f"Clicking TOC item: {toc_text}")
    toc_item.click()

    # Wait for TOC to close and page to render
    page.wait_for_timeout(2000) # Give epub.js time to render the new chapter

    # ---------------------------

    # 2. Open TTS Controls
    print("Opening TTS controls...")
    page.click('button[aria-label="Text to Speech"]')

    # Check for popup explicitly
    print("Waiting for TTS popup...")
    try:
        page.wait_for_selector('h3:has-text("Text to Speech")', timeout=2000)
    except Exception:
        print("Popup did not appear. Attempting click again...")
        page.click('button[aria-label="Text to Speech"]')
        page.wait_for_selector('h3:has-text("Text to Speech")', timeout=2000)

    # 3. Check for Queue
    print("Checking for Queue...")

    # Wait for Queue header. Fail if "No text available" appears.
    try:
        page.wait_for_function("""
            /queue/i.test(document.body.innerText) || document.body.innerText.includes('No text available')
        """, timeout=2000)
    except Exception:
        print("Wait timed out. Dumping page text:")
        print(page.inner_text("body"))
        raise

    # 4. Check for Queue Items
    page.wait_for_timeout(2000) # Allow queue to populate

    queue_header = page.locator("text=/Queue/i")
    queue_visible = queue_header.count() > 0 and queue_header.first.is_visible()

    no_text = page.is_visible("text=No text available")

    if no_text:
        # Now this is a failure condition because we navigated to a text-heavy chapter
        print("FAILURE: 'No text available' shown despite navigating to Chapter I.")
        utils.capture_screenshot(page, "tts_queue_fail_no_text")
        raise Exception("TTS Queue shows 'No text available' on a text-heavy page.")

    if queue_visible:
        print("Queue header found.")
        queue_items = page.locator("div:has(h4:has-text('Queue')) button")
        if queue_items.count() == 0:
                # Try the previous locator if the structure is slightly different
                queue_items = page.locator("text=/Queue/i").locator("xpath=following-sibling::div").locator("button")

        count = queue_items.count()
        print(f"Found {count} queue items.")

        if count == 0:
            print("FAILURE: Queue header found but 0 items.")
            utils.capture_screenshot(page, "tts_queue_fail_empty")
            raise Exception("TTS Queue is empty.")

        first_text = queue_items.first.text_content()
        print(f"First item: {first_text}")

    else:
            print("Neither Queue nor No text available found. (Unexpected state)")
            utils.capture_screenshot(page, "tts_queue_fail_unknown")
            raise Exception("TTS Queue UI not found.")

    utils.capture_screenshot(page, "tts_queue_verification")

    # Additional check: Close TTS
    print("Closing TTS controls...")
    page.click('button[aria-label="Text to Speech"]')
    page.wait_for_timeout(500)

    utils.capture_screenshot(page, "tts_queue_closed")
    print("Test Passed: TTS Queue populated successfully.")
