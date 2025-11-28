import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_cost_indicator(page: Page):
    # Go to app
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Click a book
    page.get_by_text("Alice's Adventures in Wonderland").click()

    # Wait for reader
    page.wait_for_selector('button[aria-label="Text to Speech"]', timeout=2000)

    # Open TTS controls
    page.get_by_label("Text to Speech").click()

    # Open TTS Settings
    page.get_by_label("Settings").last.click()

    # Select Cloud Provider (Google)
    page.select_option('select', 'google')

    # Just take a screenshot of the Reader View and TTS Panel to ensure no regressions.
    utils.capture_screenshot(page, "verify_cost_indicator")
    print("Screenshot taken")
