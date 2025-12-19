import re
import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_library_grid_view(page: Page):
    print("Starting Library Grid View Journey...")
    utils.reset_app(page)

    # 1. Upload first book (Alice)
    print("Uploading Alice...")
    file_input = page.get_by_test_id("hidden-file-input")
    file_input.set_input_files("verification/alice.epub")
    expect(page.locator("[data-testid^='book-card-']").first).to_be_visible(timeout=5000)

    # 2. Upload second book (Frankenstein)
    print("Uploading Frankenstein...")
    file_input.set_input_files("verification/frankenstein.epub")

    # Wait for the second book to appear
    # We expect 2 book cards
    expect(page.locator("[data-testid^='book-card-']")).to_have_count(2, timeout=5000)

    utils.capture_screenshot(page, "library_grid_2_books")

    # 3. Check for Grid Layout vs List Layout
    # Check menu trigger text
    menu_trigger = page.get_by_test_id("view-menu-trigger")
    expect(menu_trigger).to_have_text(re.compile("Classic Grid"))

    # 4. Switch to Detailed List View
    print("Switching to Detailed List View...")
    menu_trigger.click()
    # Click "Detailed List" item
    page.get_by_role("menuitemradio", name="Detailed List").click()

    expect(menu_trigger).to_have_text(re.compile("Detailed List"))
    utils.capture_screenshot(page, "library_list_view")

    # 5. Switch back to Grid View
    print("Switching back to Classic Grid View...")
    menu_trigger.click()
    page.get_by_role("menuitemradio", name="Classic Grid").click()
    expect(menu_trigger).to_have_text(re.compile("Classic Grid"))

    print("Library Grid View Journey Passed!")
