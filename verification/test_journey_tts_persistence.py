
import pytest
from playwright.sync_api import Page, expect
from verification.utils import reset_app, ensure_library_with_book

def test_journey_tts_persistence_v3(page: Page):
    print("STARTING TEST V3")
    reset_app(page)
    ensure_library_with_book(page)

    # 1. Open the book
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-view")).to_be_visible(timeout=10000)

    # 2. Go to chapter
    page.get_by_test_id("reader-toc-button").click()
    expect(page.get_by_test_id("reader-toc-sidebar")).to_be_visible()
    # Click 3rd item (Chapter II)
    page.get_by_role("button", name="Chapter II.").first.click()

    page.wait_for_timeout(3000)

    # 4. Open tts panel
    page.get_by_test_id("reader-audio-button").click()
    expect(page.get_by_test_id("tts-queue")).to_be_visible()

    # 5. Play
    page.get_by_test_id("tts-play-pause-button").click()

    # 6. Wait
    page.wait_for_timeout(3000)

    # Check pause state by aria-label
    btn = page.get_by_test_id("tts-play-pause-button")
    expect(btn).to_have_attribute("aria-label", "Pause")

    # 7. Pause
    btn.click()
    expect(btn).to_have_attribute("aria-label", "Play")

    # 8. Refresh
    print("REFRESHING")
    page.reload()
    expect(page.get_by_test_id("reader-view")).to_be_visible(timeout=10000)

    # 9. Check persistence
    page.get_by_test_id("reader-audio-button").click()
    expect(page.get_by_test_id("tts-queue")).to_be_visible()

    queue_items = page.locator("[data-testid^='tts-queue-item-']")
    expect(queue_items.first).to_be_visible()
    count = queue_items.count()
    print(f"Queue items found: {count}")
    assert count > 0
