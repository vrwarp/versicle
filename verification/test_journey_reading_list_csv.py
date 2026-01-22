import pytest
import os
import csv
from playwright.sync_api import Page, expect
from verification import utils

def test_reading_list_csv_journey(page: Page):
    print("Starting Reading List CSV Journey...")
    utils.reset_app(page)

    # 1. Make sure Alice in wonderland (demo book) is loaded but so NOT open it
    print("Uploading book...")
    # Alice should be available in verification/alice.epub
    if not os.path.exists("verification/alice.epub"):
        pytest.fail("verification/alice.epub not found")

    file_input = page.get_by_test_id("hidden-file-input")
    file_input.set_input_files("verification/alice.epub")

    # Wait for book to be visible
    # Using generic selector as IDs are non-deterministic
    book_card = page.locator("[data-testid^='book-card-']").first
    expect(book_card).to_be_visible()

    # Verify title matches to be sure
    expect(book_card.locator("[data-testid='book-title']")).to_contain_text("Alice's Adventures in Wonderland")

    # Verify 0% progress initially (progress bar shouldn't exist or be 0)
    # BookCard only renders progress container if progress > 0
    expect(book_card.locator("[data-testid='progress-bar']")).not_to_be_visible()

    # 2. Open settings, go to data management, and download the reading list
    print("Opening Settings -> Data Management...")
    # Open settings
    page.get_by_test_id("header-settings-button").click()

    # Click Data Management tab
    page.get_by_role("button", name="Data Management").click()

    print("Downloading Reading List...")
    # Use expect_download context manager
    with page.expect_download() as download_info:
        page.get_by_role("button", name="Export to CSV").click()

    download = download_info.value
    download_path = "verification/downloaded_reading_list.csv"
    # Overwrite if exists
    if os.path.exists(download_path):
        os.remove(download_path)
    download.save_as(download_path)
    print(f"Downloaded to {download_path}")

    # 3. Verify that the downloaded reading list contains Alice in wonderland
    print("Verifying content...")
    rows = []
    with open(download_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)

    alice_entry = None
    # Assuming 'Title' is the column name based on src/lib/csv.ts
    for row in rows:
        if "Alice's Adventures in Wonderland" in row.get('Title', ''):
            alice_entry = row
            break

    assert alice_entry is not None, "Alice's Adventures in Wonderland not found in CSV"
    print("Alice found in CSV.")

    # 4. Edit the downloaded reading list to advance the progress to 0.5 (50%)
    print("Modifying CSV...")
    # Read as list of lists to preserve structure for writer
    lines = []
    with open(download_path, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        lines = list(reader)

    if not lines:
        pytest.fail("Downloaded CSV is empty")

    header = lines[0]
    try:
        title_idx = header.index('Title')
        percent_idx = header.index('Percentage')
    except ValueError:
        pytest.fail(f"CSV missing required columns. Header: {header}")

    modified = False
    for i in range(1, len(lines)):
        # Check if this row is Alice
        if len(lines[i]) > title_idx and "Alice's Adventures in Wonderland" in lines[i][title_idx]:
            # Set percentage to 0.5
            lines[i][percent_idx] = "0.5"
            modified = True
            break

    assert modified, "Could not find Alice row to modify"

    modified_path = "verification/modified_reading_list.csv"
    with open(modified_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerows(lines)

    print(f"Saved modified CSV to {modified_path}")

    # 5. In the settings, import the reading list
    print("Importing modified Reading List...")

    # Setup listener for success toast or UI change if needed, but the dialog updates state.
    # The GlobalSettingsDialog shows "Importing..." then "Import Complete"

    # Upload file
    page.get_by_test_id("reading-list-csv-input").set_input_files(modified_path)

    # Wait for completion message
    expect(page.get_by_text("Import Complete", exact=True)).to_be_visible(timeout=10000)

    # Click "Return to Library"
    page.get_by_role("button", name="Return to Library").click()

    # 6. Go back to the library view and make sure that Alice in wonderland shows a 50% progress
    print("Verifying progress in Library...")
    expect(page.get_by_test_id("library-view")).to_be_visible()

    # Get the book card again
    book_card = page.locator("[data-testid^='book-card-']").first

    progress_container = book_card.locator("[data-testid='progress-container']")
    expect(progress_container).to_be_visible()

    # Check aria-label for "Reading progress: 50%"
    # Note: 0.5 * 100 = 50. Math.round(50) = 50.
    expect(progress_container).to_have_attribute("aria-label", "Reading progress: 50%")

    # Also verify visual width if possible? aria-valuenow is easier.
    expect(progress_container).to_have_attribute("aria-valuenow", "50")

    utils.capture_screenshot(page, "reading_list_csv_success")
    print("Reading List CSV Journey Passed!")

    # Cleanup
    if os.path.exists(download_path):
        os.remove(download_path)
    if os.path.exists(modified_path):
        os.remove(modified_path)
