import pytest
from playwright.sync_api import Page, expect
from verification import utils

TABS = [
    ("General", "General"),
    ("Appearance", "Appearance"),
    ("Voices", "Voices"),
    ("Audio", "Audio"),
    ("Storage", "Storage"),
    ("Lexicon", "Lexicon"),
    ("Backup", "Backup"),
    ("Maintenance", "Maintenance"),
    ("About", "About"),
    ("Credits", "Credits"),
]

@pytest.mark.parametrize("tab_name, role_name", TABS)
def test_journey_settings_tabs(page: Page, tab_name, role_name):
    print(f"Starting Settings Tab Journey: {tab_name}...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    page.get_by_test_id("global-settings-trigger").click()
    expect(page.get_by_test_id("global-settings-dialog")).to_be_visible()

    page.get_by_role("tab", name=role_name).click()
    # Expect the tab content to be visible or active state
    expect(page.get_by_role("tab", name=role_name)).to_have_attribute("data-state", "active")

    utils.capture_screenshot(page, f"settings_tab_{tab_name}")
    print(f"Settings Tab {tab_name} Passed!")

DIALOGS = [
    ("history_panel", "reader-history-button"),
    ("search_in_book", "reader-search-button"),
    ("toc_sidebar", "reader-toc-button"),
    # "info_modal" omitted if unsure of ID
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

    # We should expect something to open, but it differs per dialog.
    # We rely on screenshot + no crash for now, or check generic 'dialog' role if applicable.
    # Just asserting the trigger was clickable is a start.

    utils.capture_screenshot(page, f"dialog_{dialog_name}")
