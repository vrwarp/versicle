import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_search_journey(page: Page):
    print("Starting Search Journey...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    page.get_by_test_id("book-card").click()
    expect(page.get_by_test_id("reader-back-button")).to_be_visible()

    # Open Search
    print("Opening Search...")
    page.get_by_test_id("reader-search-button").click()
    search_input = page.get_by_test_id("search-input")
    expect(search_input).to_be_visible()

    # 1. Verify Empty State (No results found)
    print("Verifying Empty Search State...")
    search_input.fill("supercalifragilistic")
    search_input.press("Enter")
    expect(page.get_by_text('No results found for "supercalifragilistic"')).to_be_visible()
    utils.capture_screenshot(page, "search_empty_state")

    # 2. Positive Search
    # Retry search until results found (indexing might take time)
    for i in range(20):
        print(f"Search attempt {i+1}...")
        search_input.fill("Alice")
        search_input.press("Enter")

        # Wait for potential update
        page.wait_for_timeout(500)

        # Check for results using data-testid
        results = page.get_by_test_id("reader-search-sidebar").locator("button[data-testid^='search-result-']")
        count = results.count()
        print(f"List items count: {count}")

        if count > 0:
            print("Results found.")
            break
        else:
            print("No results yet, waiting...")
            page.wait_for_timeout(1000)
    else:
        raise AssertionError("Search failed to return results after attempts.")

    utils.capture_screenshot(page, "search_results")

    # Check text content of result
    first_result = page.get_by_test_id("search-result-0")
    text = first_result.text_content()
    print(f"First result: {text}")
    assert "Alice" in text or "Wonderland" in text, "Search result should contain query terms"

    # Click result to navigate
    first_result.scroll_into_view_if_needed()
    first_result.dispatch_event("click")

    # Close search
    page.wait_for_timeout(500)
    page.get_by_test_id("search-close-button").dispatch_event("click")

    utils.capture_screenshot(page, "search_after_nav")

    print("Search Journey Passed!")
