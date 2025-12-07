import pytest
from playwright.sync_api import Page, expect
from verification import utils

# Removing parametrization because utils.reset_app and conftest handle device via viewport fixture usually?
# Actually, checking other tests, they don't explicitly parameterize 'device' string unless they use it for logic logic.
# The error says "ScopeMismatch: You tried to access the function scoped fixture device with a session scoped request object".
# 'device' is likely a fixture name in pytest-playwright.
# Let's rename our parameter to avoid conflict or check how other tests do it.

def test_journey_resilience(page: Page):
    print(f"Starting Resilience Journey...")

    # 1. Reset App and Load
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # 2. Open Global Settings
    # Note: On mobile, this might be inside a menu or different layout, but GlobalSettingsDialog is global.
    # The trigger is usually in the ReaderView header or Library view?
    # Actually, GlobalSettings is usually accessed from ReaderView header "Settings" button.

    # Navigate to Reader
    page.locator("[data-testid^='book-card-']").first.click()
    page.wait_for_timeout(2000)

    # Open Settings
    page.get_by_test_id("reader-settings-button").click()

    # Wait for modal
    expect(page.get_by_role("dialog")).to_be_visible()

    # 3. Navigate to Data Management Tab
    # The tab buttons are in the sidebar.
    # On mobile, the sidebar is horizontal at top?
    # "Data Management" button
    page.get_by_role("button", name="Data Management").click()

    # 4. Verify "Export Debug Info" button exists
    export_btn = page.get_by_role("button", name="Export Debug Info")
    expect(export_btn).to_be_visible()

    # 5. Test Download Interaction
    # We setup a download listener before clicking
    with page.expect_download() as download_info:
        export_btn.click()

    download = download_info.value
    # Verify filename pattern
    assert "versicle-debug-" in download.suggested_filename
    assert download.suggested_filename.endswith(".json")

    # Optional: Verify content of download?
    # path = download.path()
    # with open(path, 'r') as f:
    #     content = json.load(f)
    #     assert "logBuffer" in content

    print("Debug Export verified successfully.")
    utils.capture_screenshot(page, "resilience_debug_export")
