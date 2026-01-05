import pytest
from playwright.sync_api import Page, expect
from verification import utils

# Updated to match GlobalSettingsDialog.tsx
TABS = [
    ("General", "General", "Advanced Import"),
    ("TTS", "TTS Engine", "Provider Configuration"),
    ("GenAI", "Generative AI", "Generative AI Configuration"),
    ("Dictionary", "Dictionary", "Pronunciation Lexicon"),
    ("Data", "Data Management", "Backup & Restore"),
]

@pytest.mark.parametrize("tab_id, button_text, content_text", TABS)
def test_journey_settings_tabs(page: Page, tab_id, button_text, content_text):
    print(f"Starting Settings Tab Journey: {tab_id}...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Settings
    expect(page.get_by_test_id("header-settings-button")).to_be_visible()
    page.get_by_test_id("header-settings-button").click()

    # Wait for dialog
    expect(page.get_by_role("dialog")).to_be_visible()

    # Click Tab
    page.get_by_role("button", name=button_text, exact=True).click()

    # Verify Content (Heading)
    expect(page.get_by_role("heading", name=content_text)).to_be_visible()

    utils.capture_screenshot(page, f"settings_tab_{tab_id}")
    print(f"Settings Tab {tab_id} Passed!")

DIALOGS = [
    ("toc_sidebar", "reader-toc-button"),
    ("search_in_book", "reader-search-button"),
]

@pytest.mark.parametrize("dialog_name, trigger_id", DIALOGS)
def test_journey_dialogs(page: Page, dialog_name, trigger_id):
    print(f"Starting Dialog Journey: {dialog_name}...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open book
    page.locator("[data-testid^='book-card-']").first.click()

    # Wait for reader controls
    expect(page.get_by_test_id(trigger_id)).to_be_visible()
    page.get_by_test_id(trigger_id).click()

    if dialog_name == "toc_sidebar":
        expect(page.get_by_test_id("reader-toc-sidebar")).to_be_visible()
    elif dialog_name == "search_in_book":
        expect(page.get_by_test_id("reader-search-sidebar")).to_be_visible()

    utils.capture_screenshot(page, f"dialog_{dialog_name}")
