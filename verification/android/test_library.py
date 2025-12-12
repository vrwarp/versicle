import re
import os
from playwright.sync_api import expect
from verification.android import utils

def test_library_journey(fresh_android_page):
    """
    Tests the Library journey on Android.
    Uses 'fresh_android_page' to ensure we start with a clean state (empty library).
    """
    page = fresh_android_page
    print("Starting Android Library Journey...")

    # 1. Verify Empty Library
    # The app might take a moment to initialize databases etc.
    expect(page.get_by_text("Your library is empty")).to_be_visible()
    expect(page.get_by_text("Import an EPUB file")).to_be_visible()
    utils.capture_screenshot(page, "library_1_empty")

    # 2. Upload Book
    print("Uploading book...")
    # Using the hidden file input
    file_input = page.get_by_test_id("hidden-file-input")

    # Resolve absolute path for the file
    file_path = os.path.abspath("src/test/fixtures/alice.epub")
    if not os.path.exists(file_path):
        # Fallback to check if we are in verification dir? No, we run from root.
        raise FileNotFoundError(f"Test fixture not found at {file_path}")

    file_input.set_input_files(file_path)

    # Verify book appears
    # Using data-testid for resilience
    expect(page.locator("[data-testid^='book-card-']").first).to_be_visible(timeout=5000)
    utils.capture_screenshot(page, "library_2_with_book")

    # 3. Persistence Check
    print("Reloading to check persistence...")
    page.reload()
    expect(page.locator("[data-testid^='book-card-']").first).to_be_visible(timeout=5000)

    # 4. Navigation Check (Clicking book)
    print("Clicking book to verify navigation...")
    page.locator("[data-testid^='book-card-']").first.click()

    # Verify URL change
    expect(page).to_have_url(re.compile(r".*/read/.*"), timeout=5000)

    # Verify we are in reader view (Back button exists)
    expect(page.get_by_test_id("reader-back-button")).to_be_visible()
    utils.capture_screenshot(page, "library_reader_view")

    print("Android Library Journey Passed!")
