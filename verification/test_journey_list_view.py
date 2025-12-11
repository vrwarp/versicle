import os
import pytest
from playwright.sync_api import Page, expect
from verification.utils import ensure_library_with_book, reset_app

def test_journey_list_view(page: Page):
    """
    Verifies the List View user journey:
    1. Setup library with a book.
    2. Toggle between Grid and List view.
    3. Verify List Item content.
    4. Verify persistence of view mode.
    """
    reset_app(page)

    # 1. Setup: Ensure library has at least one book
    ensure_library_with_book(page)

    # 2. Toggle to List View
    toggle_btn = page.get_by_test_id("view-toggle-button")
    expect(toggle_btn).to_be_visible()

    # Initial state should be grid
    book_card = page.locator("[data-testid^='book-card-']")
    expect(book_card).to_be_visible()

    # Click to switch to List
    toggle_btn.click()

    # 3. Verify List Item Content
    book_list_item = page.locator("[data-testid^='book-list-item-']")
    expect(book_list_item).to_be_visible()

    # Check for metadata text (Author is usually visible in List Item)
    expect(book_list_item).to_contain_text("Lewis Carroll")

    # Verify cover image is present
    cover_image = book_list_item.locator("img")
    expect(cover_image).to_be_visible()
    expect(cover_image).to_have_attribute("alt", "Cover for Alice's Adventures in Wonderland")

    from verification.utils import capture_screenshot
    capture_screenshot(page, "list_view_with_cover")

    # 4. Persistence
    # Reload page
    page.reload()

    # Wait for library to load
    expect(book_list_item).to_be_visible()

    # Verify we are still in List mode
    # Toggle button should now show Grid icon (aria-label="Switch to grid view")
    expect(toggle_btn).to_have_attribute("aria-label", "Switch to grid view")

    # 5. Toggle back to Grid
    toggle_btn.click()
    expect(book_card).to_be_visible()
    expect(book_list_item).not_to_be_visible()
