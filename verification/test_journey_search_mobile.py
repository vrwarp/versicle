import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_search_and_sort_mobile(page: Page):
    print("Starting Search and Sort User Journey (Mobile)...")

    # Set viewport to mobile to verify the 3-row layout and responsiveness
    page.set_viewport_size({'width': 390, 'height': 844})

    utils.reset_app(page)

    # 1. Populate Library
    print("- Populating Library...")
    # Load Demo Book (Alice)
    if page.get_by_text("Load Demo Book (Alice in Wonderland)").is_visible():
        page.get_by_text("Load Demo Book (Alice in Wonderland)").click()
        expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible(timeout=10000)

    # Ideally we'd have a second book to test sorting order effectively,
    # but for now we verify the interaction and existence of elements.

    # 2. Search Functionality
    print("- Testing Search Functionality...")
    search_input = page.get_by_test_id("library-search-input")
    expect(search_input).to_be_visible()

    # 2a. Search by Title (Positive)
    print("  - Searching by Title: 'Alice'")
    search_input.fill("Alice")
    expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible()
    utils.capture_screenshot(page, "search_result_found")

    # 2b. Search by Author (Positive)
    print("  - Searching by Author: 'Lewis Carroll'")
    search_input.fill("Lewis Carroll")
    expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible()

    # 2c. Search (Negative)
    print("  - Searching for non-existent book: 'Space Odysey'")
    search_input.fill("Space Odysey")
    expect(page.get_by_text('No books found matching "Space Odysey"')).to_be_visible()
    utils.capture_screenshot(page, "search_no_results")

    # 2d. Clear Search
    print("  - Clearing Search")
    page.get_by_role("button", name="Clear search").click()
    expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible()
    expect(search_input).to_have_value("")

    # 3. Sorting Functionality
    print("- Testing Sorting Functionality...")

    # The sort select is now a Radix UI component, not a native select.
    # We identify the trigger by test-id.
    sort_trigger = page.get_by_test_id("sort-select")
    expect(sort_trigger).to_be_visible()

    # Select 'Title'
    print("  - Sorting by Title")
    sort_trigger.click()
    # Wait for the dropdown content (Title option) and click it
    page.get_by_role("option", name="Title").click()

    # Verify selection - Radix Trigger text updates to the selected value
    expect(sort_trigger).to_contain_text("Title")
    utils.capture_screenshot(page, "search_sort_title")

    # Select 'Author'
    print("  - Sorting by Author")
    sort_trigger.click()
    page.get_by_role("option", name="Author").click()
    expect(sort_trigger).to_contain_text("Author")

    print("Search and Sort Journey Passed!")
