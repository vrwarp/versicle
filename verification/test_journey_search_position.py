
import os
import pytest
from playwright.sync_api import Page, expect
from verification.utils import reset_app

def test_search_button_position(page: Page):
    # Set viewport to ensure desktop layout
    page.set_viewport_size({'width': 1280, 'height': 800})

    # Load app
    reset_app(page)

    # Check if book exists
    if page.locator("[data-testid^='book-card-']").first.count() == 0:
        # Handle empty library if needed
        demo_btn = page.get_by_role("button", name="Load Demo Book")
        if demo_btn.count() > 0 and demo_btn.is_visible():
            print("Loading Demo Book...")
            demo_btn.click()

            # Wait a bit for processing
            page.wait_for_timeout(3000)

            # Reload page to ensure list updates
            page.reload()
            page.wait_for_load_state("networkidle")

    # Wait for book card to appear
    book_card = page.locator("[data-testid^='book-card-']").first.first
    # Use a reasonable timeout
    book_card.wait_for(timeout=30000)

    # Open the book
    book_card.click()

    # Wait for reader to load
    page.wait_for_selector('div[data-testid="reader-iframe-container"]', timeout=40000)

    # Ensure the header is visible
    page.wait_for_selector('header', timeout=10000)

    # Locate the search button
    search_btn = page.locator('button[data-testid="reader-search-button"]')
    expect(search_btn).to_be_visible()

    # Verify position
    annotations_btn = page.locator('button[data-testid="reader-annotations-button"]')

    # Check bounding boxes
    search_box = search_btn.bounding_box()
    annotations_box = annotations_btn.bounding_box()
    title = page.locator('header h1')
    title_box = title.bounding_box()

    if search_box and annotations_box and title_box:
        print(f"Annotations X: {annotations_box['x']}")
        print(f"Search X: {search_box['x']}")
        print(f"Title X: {title_box['x']}")

        # Check if search is to the left of title
        assert search_box['x'] < title_box['x'], f"Search button ({search_box['x']}) is not to the left of the title ({title_box['x']})!"

        # Check if search is to the right of annotations (optional, but good for relative ordering)
        # Note: annotations button is also on the left.
        # Order should be Back -> TOC -> Annotations -> Search
        assert search_box['x'] >= annotations_box['x'], f"Search button ({search_box['x']}) should be to the right of annotations ({annotations_box['x']})!"
    else:
        pytest.fail("Could not get bounding boxes")

    # Create verification directory if it doesn't exist
    os.makedirs('verification/screenshots', exist_ok=True)

    screenshot_path = 'verification/screenshots/search_button_left.png'
    page.locator('header').screenshot(path=screenshot_path)
