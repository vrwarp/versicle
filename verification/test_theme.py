import re
import pytest
from playwright.sync_api import Page, expect
from verification import utils
import json

def test_theme(page: Page):
    print("Starting Theme Verification...")
    utils.reset_app(page)

    # 1. Setup - Upload Book
    print("Uploading book...")
    file_input = page.get_by_test_id("hidden-file-input")
    file_input.set_input_files("src/test/fixtures/alice.epub")
    expect(page.locator("[data-testid^='book-card-']").first).to_be_visible()

    # 2. Verify Light Theme (Default)
    html = page.locator("html")
    expect(html).to_have_class(re.compile(r"\blight\b"))

    # Take screenshot
    utils.capture_screenshot(page, "theme_1_library_light")

    # 3. Open Settings
    print("Opening Settings...")
    page.get_by_test_id("header-settings-button").click()
    expect(page.get_by_text("Global Settings")).to_be_visible()

    # 4. Switch to Dark Theme
    print("Switching to Dark Theme...")
    page.get_by_label("Select Dark theme").click()
    
    # Verify Dark Class
    expect(html).to_have_class(re.compile(r"\bdark\b"))
    utils.capture_screenshot(page, "theme_2_library_dark")

    # 5. Switch to Sepia Theme
    print("Switching to Sepia Theme...")
    page.get_by_label("Select Sepia theme").click()

    # Verify Sepia Class
    expect(html).to_have_class(re.compile(r"\bsepia\b"))
    utils.capture_screenshot(page, "theme_3_library_sepia")

    # 6. Switch back to Light
    print("Switching to Light Theme...")
    page.get_by_label("Select Light theme").click()
    expect(html).to_have_class(re.compile(r"\blight\b"))

    print("Theme Verification Passed!")
