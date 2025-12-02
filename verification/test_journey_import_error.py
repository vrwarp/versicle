import re
import pytest
import os
from playwright.sync_api import Page, expect
from verification import utils

def test_import_error(page: Page):
    print("Starting Import Error Journey...")
    utils.reset_app(page)

    dummy_file = "verification/dummy.txt"
    try:
        # 1. Attempt to upload invalid file (text file)
        print("Uploading invalid file...")
        # Create a dummy text file
        with open(dummy_file, "w") as f:
            f.write("This is not an epub.")

        file_input = page.get_by_test_id("hidden-file-input")
        file_input.set_input_files(dummy_file)

        # 2. Verify Error Message
        # Wait a bit
        page.wait_for_timeout(1000)

        # Check for error container
        error_msg = page.locator(".text-destructive")

        if error_msg.is_visible():
            print("Error message found: " + error_msg.inner_text())
            utils.capture_screenshot(page, "import_error_visible")
        else:
            print("No error message visible. Verifying no book added.")
            expect(page.locator("[data-testid^='book-card-']").first).not_to_be_visible()
            utils.capture_screenshot(page, "import_error_prevented")

        print("Import Error Journey Passed!")

    finally:
        # Clean up dummy file
        if os.path.exists(dummy_file):
            os.remove(dummy_file)
