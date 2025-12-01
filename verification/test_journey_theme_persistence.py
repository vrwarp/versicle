import re
import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_theme_persistence(page: Page):
    print("Starting Theme Persistence Journey...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    page.locator('[data-testid="book-card"]').click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))
    page.wait_for_timeout(2000)

    # 1. Open Visual Settings
    print("Opening Visual Settings...")
    page.get_by_test_id("reader-visual-settings-button").click()

    # 2. Select Dark Theme
    print("Selecting Dark Theme...")
    dark_btn = page.locator('button[aria-label="Select dark theme"]')
    dark_btn.click()
    page.wait_for_timeout(1000)

    # Verify Dark Theme applied (html class)
    expect(page.locator("html")).to_have_class(re.compile(r".*dark.*"))

    # Verify Button Active
    # Checking for ring class or similar visual indicator
    # Based on previous tests, we can check if it has ring-2
    # But evaluating class list is safer
    is_active = dark_btn.evaluate("el => el.classList.contains('ring-2')")
    assert is_active, "Dark theme button should be active"

    utils.capture_screenshot(page, "theme_persistence_1_dark")

    # 3. Reload Page
    print("Reloading...")
    page.reload()
    page.wait_for_timeout(2000)

    # 4. Verify Theme Persisted
    print("Verifying Theme Persistence...")
    expect(page.locator("html")).to_have_class(re.compile(r".*dark.*"))

    # Open settings again to check button state
    page.get_by_test_id("reader-visual-settings-button").click()
    dark_btn = page.locator('button[aria-label="Select dark theme"]')
    is_active_reload = dark_btn.evaluate("el => el.classList.contains('ring-2')")
    assert is_active_reload, "Dark theme button should be active after reload"

    utils.capture_screenshot(page, "theme_persistence_2_restored")

    print("Theme Persistence Journey Passed!")
