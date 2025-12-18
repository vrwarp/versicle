import pytest
import re
from playwright.sync_api import Page, expect
from verification import utils

SETTINGS_PARAMS = [
    ("font_serif", "font-family-serif"),
    ("font_sans", "font-family-sans"),
    ("font_dyslexic", "font-family-dyslexic"),
    ("theme_sepia", "theme-sepia"),
    ("theme_dark", "theme-dark"),
    ("theme_light", "theme-light"),
    ("align_justify", "align-justify"),
    ("align_left", "align-left"),
    ("spacing_wide", "line-height-wide"),
    ("spacing_medium", "line-height-medium"),
    ("spacing_narrow", "line-height-narrow"),
    ("layout_auto", "layout-auto"),
    ("layout_single", "layout-single"),
    ("force_font", "force-font-toggle"),
]

@pytest.mark.parametrize("setting_name, test_id", SETTINGS_PARAMS)
def test_journey_reader_settings(page: Page, setting_name, test_id):
    print(f"Starting Reader Setting Journey: {setting_name}...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open book
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))
    # Wait for reader content
    expect(page.get_by_test_id("reader-settings-button")).to_be_visible()

    # Open settings
    page.get_by_test_id("reader-settings-button").click()
    expect(page.get_by_test_id("visual-settings-popover")).to_be_visible()

    # Apply setting
    expect(page.get_by_test_id(test_id)).to_be_visible()
    page.get_by_test_id(test_id).click()

    # Wait for a brief moment for styles to apply is often unavoidable in visual tests without specific style assertions
    # But we can at least ensure no error toast appeared
    # page.wait_for_timeout(500)

    utils.capture_screenshot(page, f"reader_setting_{setting_name}")
    print(f"Reader Setting {setting_name} Passed!")

FONT_SIZE_PARAMS = [
    ("increase_1", "font-size-increase", 1),
    ("increase_2", "font-size-increase", 2),
    ("decrease_1", "font-size-decrease", 1),
    ("decrease_2", "font-size-decrease", 2),
]

@pytest.mark.parametrize("action_name, test_id, repeats", FONT_SIZE_PARAMS)
def test_journey_reader_font_size(page: Page, action_name, test_id, repeats):
    print(f"Starting Font Size Journey: {action_name}...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open book
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-settings-button")).to_be_visible()

    # Open settings
    page.get_by_test_id("reader-settings-button").click()
    expect(page.get_by_test_id("visual-settings-popover")).to_be_visible()

    for _ in range(repeats):
        page.get_by_test_id(test_id).click()
        # Small wait to prevent clicking too fast for UI updates
        page.wait_for_timeout(200)

    utils.capture_screenshot(page, f"reader_font_size_{action_name}")
