import pytest
from playwright.sync_api import Page, expect
from verification.utils import reset_app, capture_screenshot

def test_verify_progress_bar(page: Page):
    # 1. Reset app to ensure clean state
    reset_app(page)

    # 2. Add the demo book (Alice in Wonderland)
    page.wait_for_timeout(2000)

    if page.get_by_text("Load Demo Book").is_visible():
        page.get_by_text("Load Demo Book").click()
        expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible(timeout=5000)

    # 3. Simulate progress by navigating in the reader
    page.get_by_text("Alice's Adventures in Wonderland").click()

    # Wait for reader container
    page.wait_for_selector('[data-testid="reader-iframe-container"]', state="attached", timeout=5000)

    # Wait for EPUB to render (sometimes takes a moment)
    page.wait_for_timeout(3000)

    # Advance pages to generate progress
    # Try to find the next button by testid or aria-label
    # Standard might be 'reader-forward-button' or aria-label="Next page"
    # Or just key press

    for _ in range(5):
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(500)

    # Go back to library
    # Try finding the back button
    back_btn = page.locator('button[aria-label="Back to Library"]')
    if not back_btn.is_visible():
         back_btn = page.get_by_test_id('reader-back-button')

    if back_btn.is_visible():
        back_btn.click()
    else:
        # Fallback: navigate via URL
        page.goto("http://localhost:5173/")

    # 4. Check for progress bar
    page.wait_for_selector('[data-testid^="book-card-"]', timeout=5000)

    # Force reload to ensure library fetches latest book data if state wasn't updated
    page.reload()
    page.wait_for_selector('[data-testid^="book-card-"]', timeout=5000)

    # Verify progress bar is visible
    # We expect some progress > 0
    expect(page.get_by_test_id("progress-bar")).to_be_visible()

    # 5. Capture screenshot
    capture_screenshot(page, name="library_progress_bar")
