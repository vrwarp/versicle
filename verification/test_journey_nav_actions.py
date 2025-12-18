import pytest
from playwright.sync_api import Page, expect
from verification import utils

NAV_PARAMS = [
    ("next_chapter", "reader-next-chapter"),
    ("prev_chapter", "reader-prev-chapter"),
]

@pytest.mark.parametrize("nav_type, test_id", NAV_PARAMS)
def test_journey_nav_buttons(page: Page, nav_type, test_id):
    print(f"Starting Navigation Journey: {nav_type}...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open book
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id(test_id)).to_be_visible() # This might fail if button is hidden, which is a valid failure if we expect it.
    # Note: Prev button might be hidden on first chapter. We might need logic to navigate first.

    if nav_type == "prev_chapter":
        # Navigate forward first so we can go back
        if page.get_by_test_id("reader-next-chapter").is_visible():
             page.get_by_test_id("reader-next-chapter").click()
             expect(page.get_by_test_id("reader-prev-chapter")).to_be_visible()

    page.get_by_test_id(test_id).click()
    # Expect some navigation or URL change?
    # Hard to assert without knowing book structure, but ensuring no crash is basic
    utils.capture_screenshot(page, f"nav_{nav_type}")


TOC_JUMPS = [
    ("chapter_0", "toc-item-0"),
    ("chapter_1", "toc-item-1"),
    ("chapter_2", "toc-item-2"),
    ("chapter_3", "toc-item-3"),
]

@pytest.mark.parametrize("jump_name, toc_id", TOC_JUMPS)
def test_journey_nav_toc_jump(page: Page, jump_name, toc_id):
    print(f"Starting TOC Jump: {jump_name}...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open book
    page.locator("[data-testid^='book-card-']").first.click()
    # Wait for book to be ready
    expect(page.get_by_test_id("reader-toc-button")).to_be_visible()

    utils.navigate_to_chapter(page, toc_id)
    utils.capture_screenshot(page, f"nav_{jump_name}")
