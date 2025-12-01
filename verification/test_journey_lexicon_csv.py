import os
import pytest
from playwright.sync_api import Page, expect
from verification.utils import reset_app

def test_journey_lexicon_csv(page: Page):
    print("Starting Lexicon CSV Import/Export Journey...")

    # 1. Reset App and Load Demo Book
    reset_app(page)

    page.get_by_text("Load Demo Book").click()
    page.get_by_text("Alice's Adventures in Wonderland").wait_for(state="visible", timeout=10000)

    # Click on the book card to open reader
    page.get_by_text("Lewis Carroll").click()

    # Wait for reader to load
    page.get_by_test_id("reader-next-page").wait_for(state="visible", timeout=10000)

    # Open Unified Audio Panel
    page.get_by_test_id("reader-tts-button").click()

    # Switch to Settings Tab (in footer of the panel)
    page.get_by_role("button", name="Settings").click()

    # Open Lexicon Manager
    page.get_by_role("button", name="Manage Pronunciation Rules").click()

    expect(page.get_by_role("heading", name="Pronunciation Lexicon")).to_be_visible()

    # 2. Download Sample CSV
    # Setup download listener
    with page.expect_download() as download_info:
        page.get_by_text("Download Sample CSV").click()

    download = download_info.value
    path = download.path()
    print(f"Downloaded sample to: {path}")

    # Verify content of sample CSV
    with open(path, 'r') as f:
        content = f.read()
        print(f"Sample CSV Content:\n{content}")
        assert "Original,Replacement,IsRegex" in content
        assert '"C++","See Plus Plus",false' in content

    # 3. Import the Sample CSV
    csv_content = """Original,Replacement,IsRegex
TestImportWord,ImportedReplacement,false
TestRegex,RegexReplacement,true
"""
    import_file_path = "verification/temp_import.csv"
    with open(import_file_path, "w") as f:
        f.write(csv_content)

    # Trigger import
    # Input is hidden, so we need to set input files on the hidden input
    page.locator('input[type="file"][data-testid="lexicon-file-input"]').set_input_files(import_file_path)

    # Wait for rules to appear
    page.get_by_text("TestImportWord").wait_for(state="visible")
    page.get_by_text("ImportedReplacement").wait_for(state="visible")

    # Verify Regex badge
    expect(page.get_by_text("TestRegex")).to_be_visible()

    print("Rules imported successfully.")

    # 4. Export CSV
    with page.expect_download() as export_info:
        page.get_by_role("button", name="Export CSV").click()

    export_download = export_info.value
    export_path = export_download.path()

    with open(export_path, 'r') as f:
        export_content = f.read()
        print(f"Exported CSV Content:\n{export_content}")
        assert "TestImportWord,ImportedReplacement,false" in export_content

    print("Lexicon CSV Journey Passed!")

    # Cleanup
    if os.path.exists(import_file_path):
        os.remove(import_file_path)
