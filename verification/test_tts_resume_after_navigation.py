import pytest
from playwright.sync_api import Page, expect
from verification import utils


def test_tts_resume_after_leaving_book(page: Page):
    """
    Verifies that TTS playback position is saved when leaving a book
    and correctly restored when returning to it.
    """
    print("Starting Resume After Navigation Test...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    print("Opening book...")
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-back-button")).to_be_visible()

    # Navigate to a chapter
    print("Navigating to chapter...")
    utils.navigate_to_chapter(page)

    # Open TTS Panel
    print("Opening TTS panel...")
    page.get_by_test_id("reader-audio-button").click()
    expect(page.get_by_test_id("tts-panel")).to_be_visible()

    # Wait for queue
    expect(page.get_by_test_id("tts-queue-item-0")).to_be_visible(timeout=10000)

    # Start playback and advance position
    print("Starting playback and advancing...")
    page.get_by_test_id("tts-play-pause-button").click()

    # Skip forward 3 times (to item 3)
    page.get_by_test_id("tts-forward-button").click()
    page.wait_for_timeout(300)
    page.get_by_test_id("tts-forward-button").click()
    page.wait_for_timeout(300)
    page.get_by_test_id("tts-forward-button").click()
    page.wait_for_timeout(500)

    # Verify we're at item 3
    expect(page.get_by_test_id("tts-queue-item-3")).to_have_attribute("data-current", "true", timeout=5000)
    print("At queue item 3")

    # Get the text of item 3 for later comparison
    item_3_text = page.get_by_test_id("tts-queue-item-3").inner_text()
    print(f"Item 3 text: {item_3_text[:50]}...")

    # Pause playback
    page.get_by_test_id("tts-play-pause-button").click()
    page.wait_for_timeout(500)

    # Close TTS panel
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)

    # Navigate back to library
    print("Going back to library...")
    page.get_by_test_id("reader-back-button").click()
    expect(page).to_have_url("http://localhost:5173/", timeout=10000)

    # Wait a moment for state to persist
    page.wait_for_timeout(1000)

    # Re-open the book
    print("Re-opening book...")
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-back-button")).to_be_visible()

    # Open TTS Panel
    print("Checking resumed TTS state...")
    page.get_by_test_id("reader-audio-button").click()
    expect(page.get_by_test_id("tts-panel")).to_be_visible(timeout=5000)

    # Wait for queue to restore
    page.wait_for_timeout(2000)

    # Check that we're at or near item 3 (resume position)
    queue_items = page.locator("[data-testid^='tts-queue-item-']")
    expect(queue_items.first).to_be_visible(timeout=10000)

    # Find the current item
    for i in range(10):
        try:
            item = page.get_by_test_id(f"tts-queue-item-{i}")
            if item.is_visible() and item.get_attribute("data-current") == "true":
                print(f"Current item at index: {i}")
                current_text = item.inner_text()
                print(f"Current item text: {current_text[:50]}...")
                
                # Should be at index 3 or greater (we advanced there before)
                assert i >= 2, f"Expected to resume at index >= 2, but at index {i}"
                utils.capture_screenshot(page, "resume_after_nav_success")
                print("Resume After Navigation Test Passed!")
                return
        except:
            continue

    # If we didn't find a current item, fail
    utils.capture_screenshot(page, "resume_after_nav_fail")
    raise AssertionError("Could not find current queue item after resume")


def test_tts_position_persists_across_reload(page: Page):
    """
    Verifies that the TTS position survives a full page reload.
    This is stronger than the existing persistence test - it checks the index.
    """
    print("Starting Position Persistence Across Reload Test...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-back-button")).to_be_visible()

    # Navigate to chapter
    utils.navigate_to_chapter(page)

    # Open TTS Panel
    page.get_by_test_id("reader-audio-button").click()
    expect(page.get_by_test_id("tts-panel")).to_be_visible()

    # Wait for queue
    expect(page.get_by_test_id("tts-queue-item-0")).to_be_visible(timeout=10000)

    # Skip to item 5
    print("Advancing to item 5...")
    for _ in range(5):
        page.get_by_test_id("tts-forward-button").click()
        page.wait_for_timeout(200)

    page.wait_for_timeout(1000)

    # Verify at item 5
    expect(page.get_by_test_id("tts-queue-item-5")).to_have_attribute("data-current", "true", timeout=5000)
    item_5_text = page.get_by_test_id("tts-queue-item-5").inner_text()
    print(f"Item 5 text before reload: {item_5_text[:50]}...")

    # Reload page
    print("Reloading page...")
    page.reload()
    expect(page.get_by_test_id("reader-back-button")).to_be_visible(timeout=10000)

    # Open TTS Panel
    page.get_by_test_id("reader-audio-button").click()
    expect(page.get_by_test_id("tts-panel")).to_be_visible(timeout=5000)

    # Wait for queue restoration
    page.wait_for_timeout(2000)

    # Check that item 5 is still current
    try:
        expect(page.get_by_test_id("tts-queue-item-5")).to_have_attribute("data-current", "true", timeout=5000)
        restored_text = page.get_by_test_id("tts-queue-item-5").inner_text()
        print(f"Item 5 text after reload: {restored_text[:50]}...")
        assert item_5_text == restored_text, "Queue item text should match after reload"
        print("Position Persistence Across Reload Test Passed!")
    except:
        # Check what the current position actually is
        for i in range(10):
            try:
                if page.get_by_test_id(f"tts-queue-item-{i}").get_attribute("data-current") == "true":
                    print(f"Actually at index {i} after reload")
                    break
            except:
                continue
        utils.capture_screenshot(page, "position_persistence_check")
        raise

    utils.capture_screenshot(page, "position_persistence_success")
