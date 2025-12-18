import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_mobile_library_grid_layout(page: Page):
    """
    Verifies that the library grid view on mobile:
    1. Does not have horizontal scrolling.
    2. Cards take up the full available width (minus gaps/padding).
    """
    print("Starting Mobile Library Grid Layout Journey...")

    # Set mobile viewport (iPhone 12)
    page.set_viewport_size({"width": 390, "height": 844})

    utils.reset_app(page)

    # 1. Upload a book
    print("Uploading Alice...")
    file_input = page.get_by_test_id("hidden-file-input")
    file_input.set_input_files("verification/alice.epub")

    book_card = page.locator("[data-testid^='book-card-']").first
    expect(book_card).to_be_visible(timeout=5000)

    utils.capture_screenshot(page, "mobile_library_grid_initial")

    # 2. Check for horizontal scroll
    has_horizontal_scroll = page.evaluate("""() => {
        const container = document.querySelector('[data-testid="library-view"]');
        return container.scrollWidth > container.clientWidth;
    }""")

    assert not has_horizontal_scroll, "Horizontal scroll detected on library grid view!"

    # 3. Check card width
    card_box = book_card.bounding_box()

    # Expected width: 390 (viewport) - 32 (padding) - 24 (gap implied by column calculation) = 334
    # We allow some tolerance
    assert card_box['width'] > 300, f"Card width {card_box['width']} is too small. Expected > 300 (full width minus padding)."

    print("Mobile Library Grid Layout Journey Passed!")
