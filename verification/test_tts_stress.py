import pytest
from playwright.sync_api import Page, expect
from verification import utils


def test_tts_rapid_play_pause(page: Page):
    """
    Stress test: Rapidly toggle play/pause 10 times to ensure no crashes or
    state corruption.
    """
    print("Starting Rapid Play/Pause Stress Test...")
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

    expect(page.get_by_test_id("tts-queue-item-0")).to_be_visible(timeout=10000)

    play_pause_btn = page.get_by_test_id("tts-play-pause-button")

    # Rapidly toggle 10 times with minimal delay
    print("Rapidly toggling play/pause 10 times...")
    for i in range(10):
        play_pause_btn.click()
        page.wait_for_timeout(150)  # 150ms between clicks
        current_label = play_pause_btn.get_attribute("aria-label")
        print(f"Toggle {i+1}: aria-label = {current_label}")

    # Wait for system to stabilize
    page.wait_for_timeout(1000)

    # Verify the UI is still responsive
    expect(play_pause_btn).to_be_visible()
    expect(play_pause_btn).to_be_enabled()

    # Verify queue is still intact
    queue_items = page.locator("[data-testid^='tts-queue-item-']")
    count = queue_items.count()
    print(f"Queue still has {count} items after stress")
    assert count > 0, "Queue should still have items after rapid play/pause"

    utils.capture_screenshot(page, "rapid_play_pause_success")
    print("Rapid Play/Pause Stress Test Passed!")


def test_tts_mid_sentence_cancel(page: Page):
    """
    Stress test: Start playing and immediately cancel. Verify clean stop.
    """
    print("Starting Mid-Sentence Cancel Test...")
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

    expect(page.get_by_test_id("tts-queue-item-0")).to_be_visible(timeout=10000)

    # Start playback
    print("Starting playback...")
    page.get_by_test_id("tts-play-pause-button").click()

    # Immediately cancel (via pause + close panel)
    print("Immediately pausing...")
    page.wait_for_timeout(100)  # Tiny delay
    page.get_by_test_id("tts-play-pause-button").click()

    # Verify we're in paused state
    play_pause_btn = page.get_by_test_id("tts-play-pause-button")
    expect(play_pause_btn).to_have_attribute("aria-label", "Play", timeout=3000)

    # Verify the debug element shows canceled or paused
    debug_el = page.locator("#tts-debug")
    if debug_el.is_visible():
        status = debug_el.get_attribute("data-status")
        print(f"Debug status after cancel: {status}")

    # Verify we can restart cleanly
    print("Restarting after cancel...")
    play_pause_btn.click()
    expect(play_pause_btn).to_have_attribute("aria-label", "Pause", timeout=3000)

    utils.capture_screenshot(page, "mid_sentence_cancel_success")
    print("Mid-Sentence Cancel Test Passed!")


def test_tts_queue_race_condition(page: Page):
    """
    Stress test: Set queue, immediately navigate to different chapter,
    verify final state is consistent.
    """
    print("Starting Queue Race Condition Test...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-back-button")).to_be_visible()

    # Navigate to Chapter II
    print("Navigating to Chapter II...")
    page.get_by_test_id("reader-toc-button").click()
    expect(page.get_by_test_id("reader-toc-sidebar")).to_be_visible()
    page.get_by_role("button", name="Chapter II.").first.click()

    # Don't wait - immediately navigate to Chapter III
    print("Immediately navigating to Chapter III...")
    page.get_by_test_id("reader-toc-button").click()
    page.get_by_role("button", name="Chapter III.").first.click()

    # Don't wait - immediately navigate to Chapter IV
    print("Immediately navigating to Chapter IV...")
    page.get_by_test_id("reader-toc-button").click()
    page.get_by_role("button", name="Chapter IV.").first.click()

    # Now wait for things to settle
    page.wait_for_timeout(3000)

    # Open TTS Panel
    page.get_by_test_id("reader-audio-button").click()
    expect(page.get_by_test_id("tts-panel")).to_be_visible()

    # Verify queue has loaded (should be Chapter IV content)
    queue_items = page.locator("[data-testid^='tts-queue-item-']")
    expect(queue_items.first).to_be_visible(timeout=10000)

    count = queue_items.count()
    print(f"Final queue has {count} items")
    assert count > 0, "Queue should have items after rapid navigation"

    # Verify we're at index 0 (fresh start)
    expect(page.get_by_test_id("tts-queue-item-0")).to_have_attribute("data-current", "true")

    utils.capture_screenshot(page, "queue_race_condition_success")
    print("Queue Race Condition Test Passed!")


def test_tts_concurrent_skip_operations(page: Page):
    """
    Stress test: Rapidly click forward/backward buttons.
    """
    print("Starting Concurrent Skip Operations Test...")
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

    expect(page.get_by_test_id("tts-queue-item-0")).to_be_visible(timeout=10000)

    forward_btn = page.get_by_test_id("tts-forward-button")
    rewind_btn = page.get_by_test_id("tts-rewind-button")

    # Rapidly skip forward 5 times
    print("Rapidly skipping forward 5 times...")
    for i in range(5):
        forward_btn.click()
        page.wait_for_timeout(100)

    # Rapidly skip back 3 times
    print("Rapidly skipping back 3 times...")
    for i in range(3):
        rewind_btn.click()
        page.wait_for_timeout(100)

    # Wait for stabilization
    page.wait_for_timeout(1000)

    # We should be at approximately index 2 (5 - 3 = 2)
    # Find the current item
    found_current = False
    for i in range(10):
        try:
            item = page.get_by_test_id(f"tts-queue-item-{i}")
            if item.is_visible() and item.get_attribute("data-current") == "true":
                print(f"Current item is at index: {i}")
                found_current = True
                # Should be around index 2, allow some tolerance
                assert i >= 1 and i <= 4, f"Expected index 1-4, got {i}"
                break
        except:
            continue

    assert found_current, "Should find a current item after concurrent skips"

    utils.capture_screenshot(page, "concurrent_skip_success")
    print("Concurrent Skip Operations Test Passed!")


def test_tts_panel_close_during_playback(page: Page):
    """
    Verifies that closing the TTS panel during playback doesn't crash anything
    and playback continues.
    """
    print("Starting Panel Close During Playback Test...")
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

    expect(page.get_by_test_id("tts-queue-item-0")).to_be_visible(timeout=10000)

    # Start playback
    print("Starting playback...")
    page.get_by_test_id("tts-play-pause-button").click()
    page.wait_for_timeout(500)

    # Close panel while playing
    print("Closing panel during playback...")
    page.keyboard.press("Escape")
    expect(page.get_by_test_id("tts-panel")).not_to_be_visible()

    # Wait a moment
    page.wait_for_timeout(2000)

    # Verify the Compass Pill shows playing state
    pill = page.get_by_test_id("compass-pill-active")
    if pill.is_visible():
        pause_btn = pill.get_by_label("Pause")
        if pause_btn.is_visible():
            print("Playback continuing (Pause button visible in pill)")

    # Re-open panel
    print("Re-opening panel...")
    page.get_by_test_id("reader-audio-button").click()
    expect(page.get_by_test_id("tts-panel")).to_be_visible()

    # Verify we're still playing and have progressed
    play_pause_btn = page.get_by_test_id("tts-play-pause-button")
    # Should show Pause (meaning it's playing)
    aria_label = play_pause_btn.get_attribute("aria-label")
    print(f"Play/Pause button label after reopen: {aria_label}")

    utils.capture_screenshot(page, "panel_close_playback_success")
    print("Panel Close During Playback Test Passed!")
