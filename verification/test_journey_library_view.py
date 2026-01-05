import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_library_grid_list_toggle(page: Page):
    """
    Verifies the Library View Toggle (Grid/List) on Desktop.
    Includes persistence check.
    """
    print("Starting Library Grid/List Toggle Journey...")

    # Set desktop viewport
    page.set_viewport_size({"width": 1280, "height": 800})
    utils.reset_app(page)

    # 1. Upload first book (Alice)
    print("Uploading Alice...")
    file_input = page.get_by_test_id("hidden-file-input")
    file_input.set_input_files("verification/alice.epub")
    # Increase timeout for upload
    expect(page.locator("[data-testid^='book-card-']").first).to_be_visible(timeout=10000)

    # 2. Upload second book (Frankenstein) to check multiple items
    print("Uploading Frankenstein...")
    file_input.set_input_files("verification/frankenstein.epub")

    # Increase timeout for second upload
    expect(page.locator("[data-testid^='book-card-']")).to_have_count(2, timeout=10000)

    utils.capture_screenshot(page, "library_view_1_grid_initial")

    # 3. Check for Grid Layout (Default)
    toggle_btn = page.get_by_test_id("view-toggle-button")
    expect(toggle_btn).to_be_visible()
    # Expect Grid View (Button says "Switch to list view")
    expect(toggle_btn).to_have_attribute("aria-label", "Switch to list view")
    expect(page.locator("[data-testid^='book-card-']").first).to_be_visible()

    # 4. Switch to List View
    print("Switching to List View...")
    toggle_btn.click()

    # Verify List View
    expect(toggle_btn).to_have_attribute("aria-label", "Switch to grid view")

    # Find Alice specifically (since Frankenstein might be first due to sort order)
    book_list_item = page.locator("[data-testid^='book-list-item-']").filter(has_text="Alice's Adventures in Wonderland").first
    expect(book_list_item).to_be_visible()

    # Verify Metadata in List Item
    expect(book_list_item).to_contain_text("Lewis Carroll")
    expect(book_list_item.locator("img")).to_be_visible()

    utils.capture_screenshot(page, "library_view_2_list_mode")

    # 5. Persistence Check
    print("Reloading to check persistence...")
    page.reload()
    expect(book_list_item).to_be_visible(timeout=5000)
    expect(toggle_btn).to_have_attribute("aria-label", "Switch to grid view")

    # 6. Switch back to Grid View
    print("Switching back to Grid View...")
    toggle_btn.click()
    expect(toggle_btn).to_have_attribute("aria-label", "Switch to list view")
    expect(page.locator("[data-testid^='book-card-']").first).to_be_visible()

    print("Library Grid/List Toggle Journey Passed!")

def test_mobile_library_grid_layout(page: Page):
    """
    Verifies that the library grid view on mobile:
    1. Does not have horizontal scrolling.
    2. Cards have appropriate width for a two-column layout.
    """
    print("Starting Mobile Library Grid Layout Journey...")

    # Set mobile viewport (iPhone 12)
    page.set_viewport_size({"width": 390, "height": 844})

    utils.reset_app(page)

    # 1. Ensure Library has a book
    utils.ensure_library_with_book(page)
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

    # Expected width: (390 - 32 padding - 24 gap) / 2 = 167px
    # We allow some tolerance to verify it fits 2 columns (approx 140-180px)
    if card_box:
        width = card_box['width']
        assert 140 <= width < 200, f"Card width {width} is unexpected. Expected between 140 and 200 for 2-column mobile grid."

    print("Mobile Library Grid Layout Journey Passed!")
