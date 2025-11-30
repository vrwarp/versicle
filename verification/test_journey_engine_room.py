import pytest
from playwright.sync_api import Page, expect
from verification import utils
import re

def test_engine_room_journey(page: Page):
    print("Starting Engine Room Journey...")
    utils.reset_app(page)

    # 1. Test from Library
    print("Testing from Library...")
    page.goto("http://localhost:5173") # Ensure at root
    # Wait for library to load
    expect(page.get_by_text("My Library")).to_be_visible(timeout=5000)

    settings_btn = page.get_by_test_id("header-settings-button")
    expect(settings_btn).to_be_visible()
    settings_btn.click()

    # Verify Dialog Open
    expect(page.get_by_role("dialog")).to_be_visible()
    # Check sidebar header
    expect(page.get_by_role("heading", name="Settings", exact=True)).to_be_visible()

    # Verify Tabs exist
    expect(page.get_by_role("button", name="General")).to_be_visible()
    expect(page.get_by_role("button", name="TTS Engine")).to_be_visible()
    expect(page.get_by_role("button", name="Dictionary")).to_be_visible()

    # Check General Tab Content (default)
    expect(page.get_by_text("Gesture Mode")).to_be_visible()

    # Switch to TTS
    page.get_by_role("button", name="TTS Engine").click()
    expect(page.get_by_text("Provider Configuration")).to_be_visible()
    expect(page.get_by_text("Active Provider")).to_be_visible()

    # Close Dialog (Radix Dialog Close button usually has sr-only text "Close")
    page.get_by_role("button", name="Close").click()
    expect(page.get_by_role("dialog")).not_to_be_visible()

    # 2. Test from Reader
    print("Testing from Reader...")
    utils.ensure_library_with_book(page)
    page.locator('[data-testid="book-card"]').click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))
    page.wait_for_timeout(2000)

    # Click Settings (Gear)
    reader_settings_btn = page.get_by_test_id("reader-settings-button")
    reader_settings_btn.click()

    expect(page.get_by_role("dialog")).to_be_visible()
    expect(page.get_by_role("button", name="General")).to_be_visible()

    utils.capture_screenshot(page, "engine_room_01_open")
    print("Engine Room Journey Passed!")
