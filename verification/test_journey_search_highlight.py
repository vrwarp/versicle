import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_journey_search_highlight(page: Page):
    print("Starting Search Journey Highlight Test...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    page.get_by_test_id("book-card").click()
    expect(page.get_by_test_id("reader-back-button")).to_be_visible()

    # Wait for indexing
    print("Waiting for indexing...")
    page.wait_for_timeout(3000)

    # Open Search
    print("Searching...")
    page.get_by_test_id("reader-search-button").click()
    utils.capture_screenshot(page, "search_highlight_start")

    # Search for term
    search_input = page.get_by_test_id("search-input")
    search_input.fill("waistcoat-pocket")
    search_input.press("Enter")

    # Wait for results
    expect(page.locator("button[data-testid^='search-result-']").first).to_be_visible(timeout=10000)
    utils.capture_screenshot(page, "search_highlight_results")

    # Click result
    print("Clicking result...")
    page.get_by_test_id("search-result-0").click()

    # Wait for highlight to appear in the iframe
    print("Checking for highlight...")
    page.wait_for_timeout(2000)

    iframe_element = page.locator("iframe[id^='epubjs-view']")
    if iframe_element.count() == 0:
        iframe_element = page.locator("#reader-iframe-container iframe")

    frame = iframe_element.content_frame
    expect(frame.locator(".search-highlight")).to_be_visible(timeout=5000)

    utils.capture_screenshot(page, "search_highlight_found")

    print("Search Journey Highlight Passed!")
