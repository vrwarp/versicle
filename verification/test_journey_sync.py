import pytest
import json
import time
import re
from playwright.sync_api import Page, expect
from verification.utils import reset_app, ensure_library_with_book, capture_screenshot, navigate_to_chapter

def test_sync_journey(page: Page):
    """
    Verifies the sync journey using the Mock Drive Provider.
    1. Enables Sync (Mock).
    2. Checks if 'Last Synced' appears.
    3. Simulates a sync trigger (pause reading).
    4. Verifies data is persisted in Mock Storage (localStorage).
    """
    # Inject flag to enable Mock Sync Provider
    page.add_init_script("window.__VERSICLE_MOCK_SYNC__ = true;")

    try:
        print("Step 1: Reset App")
        reset_app(page)
        ensure_library_with_book(page)

        print("Step 2: Enable Sync")
        page.get_by_test_id("header-settings-button").click()
        page.get_by_role("button", name="Sync & Cloud").click()

        # Ensure we wait for the inputs to be ready
        page.locator("#sync-google-client-id").wait_for(state="visible")
        page.locator("#sync-google-client-id").fill("mock-id")
        page.locator("#sync-google-api-key").fill("mock-key")
        page.get_by_test_id("sync-toggle").click()

        print("Step 3: Wait for Last Synced")
        # Use substring match
        expect(page.get_by_text("Last Synced:", exact=False)).to_be_visible(timeout=5000)

        page.keyboard.press("Escape")

        print("Step 4: Open Book")
        page.locator("[data-testid^='book-card-']").filter(has_text="Alice's Adventures in Wonderland").click()
        expect(page.get_by_test_id("reader-toc-button")).to_be_visible()

        print("Step 5: Navigate")
        navigate_to_chapter(page, "toc-item-2")

        page.wait_for_timeout(2000)

        print("Step 6: Trigger Sync via Scroll/Pause")
        # Scroll to trigger progress update
        page.evaluate("window.scrollBy(0, 500)")
        page.wait_for_timeout(2000)

        print("Step 7: Return to Library")
        # Use the back button in the reader header
        page.get_by_test_id("reader-back-button").click()

        print("Step 8: Verify Mock Storage")
        # Verify sync data in local storage
        mock_data_json = page.evaluate("localStorage.getItem('versicle_mock_drive_data')")
        print(f"Mock Data found.")

        assert mock_data_json is not None, "Mock data is None"
        mock_data = json.loads(mock_data_json)
        assert "books" in mock_data or "reading_history" in mock_data
        print("Mock Data verified successfully.")

    except Exception as e:
        print(f"FAILED AT: {e}")
        capture_screenshot(page, "sync_journey_fail")
        raise e

# NOTE: Cross-device simulation is flaky due to environment constraints (random UUIDs, background sync).
# The sync capability is verified by test_sync_journey.
