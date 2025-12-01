import re
import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_immersive_mode(page: Page):
    print("Starting Immersive Mode Journey...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    page.locator('[data-testid="book-card"]').click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))
    page.wait_for_timeout(2000)

    # Verify Header and Footer are initially visible
    header = page.locator("header")
    footer = page.locator("footer")
    expect(header).to_be_visible()
    expect(footer).to_be_visible()

    # Enter Immersive Mode
    print("Entering Immersive Mode...")
    immersive_enter_btn = page.get_by_test_id("reader-immersive-enter-button")
    immersive_enter_btn.click()

    # Verify Header and Footer are hidden
    expect(header).not_to_be_visible()
    expect(footer).not_to_be_visible()

    # Verify Exit Button is visible
    exit_btn = page.get_by_test_id("reader-immersive-exit-button")
    expect(exit_btn).to_be_visible()

    utils.capture_screenshot(page, "immersive_mode_active")

    # Exit Immersive Mode
    print("Exiting Immersive Mode...")
    exit_btn.click()

    # Verify Header and Footer are back
    expect(header).to_be_visible()
    expect(footer).to_be_visible()

    # Verify Exit Button is hidden
    expect(exit_btn).not_to_be_visible()

    utils.capture_screenshot(page, "immersive_mode_exited")

    print("Immersive Mode Journey Passed!")
