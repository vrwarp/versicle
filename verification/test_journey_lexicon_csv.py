import os
import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_journey_lexicon_csv(page: Page):
    """
    User Journey: Lexicon CSV Import/Export
    1. Open Global Settings -> Dictionary.
    2. Download sample CSV.
    3. Import the sample CSV.
    4. Verify rules are added.
    """

    # 1. Reset App and Open Settings
    utils.reset_app(page)

    # Open Global Settings
    page.get_by_test_id("header-settings-button").click()
    page.get_by_role("button", name="Dictionary").click()
    page.get_by_role("button", name="Manage Rules").click()

    utils.capture_screenshot(page, "lexicon_csv_01_initial_empty")

    # 2. Download Sample
    with page.expect_download() as download_info:
        page.get_by_test_id("lexicon-download-sample").click()
    download = download_info.value
    # Verify filename
    assert download.suggested_filename == "lexicon_sample.csv"

    # Save the downloaded file to a path so we can import it back
    download_path = download.path()

    # 3. Import Sample CSV (using the downloaded file)
    try:
        # Upload the file
        page.locator('input[data-testid="lexicon-import-input"]').set_input_files(download_path)

        # 4. Verify rules are added
        # Use .first to avoid potential duplicates or strict mode violations
        expect(page.get_by_text("Dr.", exact=True).first).to_be_visible()
        expect(page.get_by_text("Doctor", exact=True).first).to_be_visible()

        expect(page.get_by_text("API", exact=True).first).to_be_visible()
        expect(page.get_by_text("A.P.I.").first).to_be_visible()

        expect(page.get_by_text("cat|dog").first).to_be_visible()
        expect(page.get_by_text("pet").first).to_be_visible()

        # Verify regex badge
        expect(page.get_by_test_id("lexicon-regex-badge").first).to_be_visible()

        utils.capture_screenshot(page, "lexicon_csv_02_imported")

    finally:
        # Playwright cleans up downloads automatically but explicitly deleting if we moved it would be needed
        # In this case download.path() points to a temp location managed by PW.
        pass
