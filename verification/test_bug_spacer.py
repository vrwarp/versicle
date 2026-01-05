import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_spacer_bug(page: Page):
    print("Starting Spacer Bug Test...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # 1. Open Book first time to set Scrolled Mode
    print("Opening book to set Scrolled Mode...")
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-back-button")).to_be_visible()
    page.wait_for_timeout(2000)

    # Enable Scrolled Mode
    visual_btn = page.get_by_test_id("reader-visual-settings-button")
    visual_btn.click()
    scrolled_tab = page.get_by_role("tab", name="Scrolled")
    scrolled_tab.click()
    page.wait_for_timeout(1000)

    # Close settings (click outside)
    page.mouse.click(10, 10)

    # Go back to library
    page.get_by_test_id("reader-back-button").click()
    expect(page.get_by_test_id("reader-back-button")).not_to_be_visible()

    # 2. Open Book again (Entering from library in Scrolled Mode)
    print("Opening book again (should be in Scrolled Mode)...")
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-back-button")).to_be_visible()

    # Wait for content to render
    page.wait_for_timeout(3000)

    # Locate the iframe
    reader_frame = page.locator('[data-testid="reader-iframe-container"] iframe').content_frame

    # Check for spacer
    spacer = reader_frame.locator("#reader-bottom-spacer")

    if spacer.count() > 0:
        print("Spacer found!")
    else:
        print("Spacer NOT found!")

    utils.capture_screenshot(page, "spacer_bug_check")

    expect(spacer).to_have_count(1, timeout=5000)
