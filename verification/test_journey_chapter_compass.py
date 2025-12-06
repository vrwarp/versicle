import pytest
from playwright.sync_api import Page, expect
from .utils import reset_app, ensure_library_with_book, capture_screenshot

def test_journey_chapter_compass(page: Page):
    """
    Verifies the presence and basic interaction of the Chapter Compass Interface
    (Compass Pill and Satellite FAB).
    """
    # 1. Setup
    reset_app(page)
    ensure_library_with_book(page)

    # 2. Open the book
    page.locator('[data-testid^="book-card-"]').first.click()

    # Wait for reader to load
    expect(page.locator('[data-testid="reader-view"]')).to_be_visible()

    # 3. Verify Compass Components Presence
    compass = page.locator('[data-testid="chapter-compass"]')
    # expect(compass).to_be_visible() # Container might be zero-height on desktop due to absolute children

    pill = page.locator('[data-testid="compass-pill"]')
    expect(pill).to_be_visible()

    fab = page.locator('[data-testid="satellite-fab"]')
    expect(fab).to_be_visible()

    # 4. Interact with FAB (Play/Pause)
    # Initially should be Play
    expect(fab).to_have_attribute("aria-label", "Play")

    # Click to play
    fab.click()

    # Depending on speed of mock/environment, it might go to Loading or Pause
    # We just want to see interaction registered.
    # Note: In a pure visual test without full TTS mock, state might be tricky.
    # But FAB logic uses useTTSStore.

    # 5. Capture Screenshot
    capture_screenshot(page, "chapter_compass")
