import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_settings_journey(page: Page):
    print("Starting Settings Journey...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    page.locator('[data-testid="book-card"]').click()
    expect(page.get_by_test_id("reader-back-button")).to_be_visible()
    # Wait for book to load
    page.wait_for_timeout(2000)

    # Navigate to a page with text (Chapter 1)
    print("Navigating to Chapter 1...")
    next_btn = page.get_by_test_id("reader-next-page")
    # Click a few times to get past cover/intro
    for _ in range(3):
        next_btn.click()
        page.wait_for_timeout(1000)

    # 1. Open Settings
    print("Opening Settings...")
    settings_btn = page.get_by_test_id("reader-settings-button")
    settings_btn.click()
    expect(page.get_by_test_id("settings-panel")).to_be_visible()
    utils.capture_screenshot(page, "settings_1_open")

    # 2. Select Custom Theme
    print("Selecting Custom Theme...")
    custom_theme_btn = page.get_by_test_id("settings-theme-custom")
    custom_theme_btn.click()

    # Verify color pickers appear
    expect(page.get_by_test_id("settings-custom-bg")).to_be_visible()
    expect(page.get_by_test_id("settings-custom-fg")).to_be_visible()
    utils.capture_screenshot(page, "settings_2_custom_selected")

    # 3. Change Font Family
    print("Changing Font Family...")
    font_select = page.get_by_test_id("settings-font-family")
    font_select.select_option("Consolas, Monaco, monospace")

    utils.capture_screenshot(page, "settings_3_monospace")

    # 4. Change Line Height
    print("Changing Line Height...")
    # Locator for line height slider using test id
    page.get_by_test_id("settings-line-height-range").fill("2")
    utils.capture_screenshot(page, "settings_4_line_height")

    # 5. Persistence
    print("Reloading to check persistence...")
    page.reload()
    expect(page.get_by_test_id("reader-back-button")).to_be_visible(timeout=2000)
    page.wait_for_timeout(2000)

    # Open settings again
    settings_btn.click()

    # Verify custom theme is selected (custom bg picker visible)
    expect(page.get_by_test_id("settings-custom-bg")).to_be_visible()

    # Verify font family value
    font_select = page.get_by_test_id("settings-font-family")
    value = font_select.input_value()
    if "monospace" not in value:
            raise Exception(f"Persistence failed: Font family is {value}")

    print("Settings Journey Passed!")
