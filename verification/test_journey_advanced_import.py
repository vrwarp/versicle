
import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_journey_advanced_import(page: Page):
    """
    Verifies the Advanced Import options (ZIP and Folder) in Global Settings.
    """
    # 1. Open App
    page.goto("/")
    expect(page.get_by_test_id("library-view")).to_be_visible()
    utils.capture_screenshot(page, "advanced_import_01_library_view")

    # 2. Open Global Settings
    page.get_by_test_id("header-settings-button").click()
    expect(page.get_by_role("dialog")).to_be_visible()

    # Verify "General" tab is active (default) and shows Advanced Import options
    expect(page.get_by_role("heading", name="Advanced Import")).to_be_visible()

    zip_btn = page.get_by_role("button", name="Import ZIP Archive")
    folder_btn = page.get_by_role("button", name="Import Folder")

    expect(zip_btn).to_be_visible()
    expect(folder_btn).to_be_visible()

    utils.capture_screenshot(page, "advanced_import_02_settings_dialog")

    # 3. Simulate ZIP Upload (Partial verification - ensuring file chooser triggers)
    # We won't actually upload a file because we need a valid ZIP in the container,
    # but we can verify the input is wired up.

    # Verify hidden inputs exist
    expect(page.locator("input[type='file'][accept='.zip']")).to_be_attached()
    expect(page.locator("input[type='file'][webkitdirectory]")).to_be_attached()

    # Optional: Click logic check
    # We can use a filechooser event listener to verify clicking the button opens the dialog
    with page.expect_file_chooser() as fc_info:
        zip_btn.click()
    file_chooser = fc_info.value
    assert file_chooser is not None

    # Close settings
    page.keyboard.press("Escape")
    expect(page.get_by_role("dialog")).not_to_be_visible()
    utils.capture_screenshot(page, "advanced_import_03_closed_settings")
