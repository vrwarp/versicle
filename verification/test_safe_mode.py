import os
from playwright.sync_api import Page, expect
import pytest
from verification import utils

def test_safe_mode_trigger(page: Page):
    """
    Verifies that the Safe Mode screen appears when the DB fails to initialize.
    This test simulates failure by overriding window.indexedDB.open to throw an error.
    """
    print("Starting Safe Mode Verification...")

    # Override indexedDB.open before the app loads
    page.add_init_script("""
        const originalOpen = window.indexedDB.open.bind(window.indexedDB);
        window.indexedDB.open = function(...args) {
            if (args[0] === 'EpubLibraryDB') {
                throw new Error('Simulated DB Failure');
            }
            return originalOpen(...args);
        };
    """)

    page.goto("http://localhost:5173")

    # Wait for Safe Mode screen
    # We look for the "Safe Mode" heading
    try:
        expect(page.get_by_role("heading", name="Safe Mode")).to_be_visible(timeout=5000)
        print("Safe Mode screen visible.")
    except Exception as e:
        utils.capture_screenshot(page, "safe_mode_failure")
        raise e

    # Verify error message is displayed
    # Use .first to avoid strict mode violation if multiple elements contain the text
    expect(page.get_by_text("Simulated DB Failure").first).to_be_visible()

    # Verify buttons
    expect(page.get_by_role("button", name="Try Again")).to_be_visible()
    expect(page.get_by_role("button", name="Reset Database")).to_be_visible()

    print("Safe Mode verification successful.")
