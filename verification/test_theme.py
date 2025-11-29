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
    file_input = page.get_by_test_id("file-upload-input")
    file_input.set_input_files("src/test/fixtures/alice.epub")
    expect(page.get_by_test_id("book-card")).to_be_visible(timeout=2000)

    # 2. Verify Light Theme (Default)
    html = page.locator("html")
    expect(html).to_have_class(re.compile(r"\blight\b"))

    # Take screenshot
    utils.capture_screenshot(page, "theme_1_library_light")

    # 3. Verify Dark Theme
    print("Switching to Dark Theme via localStorage...")

    # Need to structure it exactly as zustand persist expects
    dark_state = {
        "state": {
            "currentTheme": "dark",
            "customTheme": {"bg": "#ffffff", "fg": "#000000"},
            "fontFamily": "serif",
            "lineHeight": 1.5,
            "fontSize": 100,
            "toc": [],
            "isLoading": False,
            "currentBookId": None,
            "currentCfi": None,
            "currentChapterTitle": None,
            "progress": 0
        },
        "version": 0
    }

    json_state = json.dumps(dark_state)

    page.evaluate(f"localStorage.setItem('reader-storage', '{json_state}')")
    page.reload()

    # Verify Dark Class
    expect(html).to_have_class(re.compile(r"\bdark\b"))

    # Verify visual change
    utils.capture_screenshot(page, "theme_2_library_dark")

    # 4. Verify Sepia Theme
    print("Switching to Sepia Theme via localStorage...")
    sepia_state = json_state.replace("dark", "sepia")
    page.evaluate(f"localStorage.setItem('reader-storage', '{sepia_state}')")
    page.reload()

    # Verify Sepia Class
    expect(html).to_have_class(re.compile(r"\bsepia\b"))

    # Verify visual change
    utils.capture_screenshot(page, "theme_3_library_sepia")

    print("Theme Verification Passed!")
