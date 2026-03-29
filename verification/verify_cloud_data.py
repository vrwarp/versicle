import pytest
from utils import get_browser, upload_file, wait_for_text, click_text

def test_delete_cloud_data_button():
    browser = get_browser()
    page = browser.new_page()
    page.goto("http://localhost:5173")

    # Use standard utility from verification tests
    wait_for_text(page, "Library")

    # Click settings
    page.get_by_test_id("header-settings-button").click()
    page.wait_for_timeout(500)

    click_text(page, "Data Management")
    page.wait_for_timeout(500)

    page.get_by_text("Danger Zone").scroll_into_view_if_needed()

    # Just need to check if the button exists and can be clicked
    btn = page.get_by_text("Delete Cloud Data")
    assert btn.is_visible()

    # Let's try screenshotting this and save to the verification folders
    import os
    os.makedirs("/home/jules/verification/screenshots", exist_ok=True)
    page.screenshot(path="/home/jules/verification/screenshots/verification.png")

    # Close
    browser.close()

if __name__ == "__main__":
    test_delete_cloud_data_button()
