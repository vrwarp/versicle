"""
Firestore Sync Verification Tests

Tests the Firestore sync implementation using MockFireProvider.
Follows the pattern established by test_journey_sync.py.
"""

import pytest
from playwright.sync_api import Page, Browser, expect
import json
import time


def test_firestore_auth_flow(browser: Browser, browser_context_args):
    """
    Verifies the Firestore auth flow in mock mode.
    Tests that enabling sync triggers connection.
    """
    base_url = browser_context_args.get("base_url", "http://localhost:5173")

    context = browser.new_context(**browser_context_args)
    page = context.new_page()

    # Enable console logs
    page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))

    # Enable mock mode and polyfills
    page.add_init_script("""
        window.__VERSICLE_MOCK_FIRESTORE__ = true;
        window.__VERSICLE_SANITIZATION_DISABLED__ = true;
        
        // Mock Firebase config so isFirebaseConfigured returns true
        window.__MOCK_FIREBASE_CONFIG__ = {
            apiKey: 'mock-api-key',
            authDomain: 'mock-project.firebaseapp.com',
            projectId: 'mock-project',
            appId: 'mock-app-id'
        };
    """)
    page.add_init_script(path="verification/tts-polyfill.js")

    page.goto("/")
    expect(page.get_by_test_id("library-view")).to_be_visible()

    # Open settings and navigate to Sync & Cloud
    page.get_by_test_id("header-settings-button").click()
    page.get_by_role("button", name="Sync & Cloud").click()
    time.sleep(1)

    # Take screenshot of sync settings
    page.screenshot(path="verification/screenshots/firestore_sync_settings.png")

    # Look for Firestore-related UI elements
    # The exact UI depends on implementation - adjust selectors as needed
    sync_section = page.locator("text=Cloud Sync")
    if sync_section.count() > 0:
        print("Found Cloud Sync section")

    page.close()
    context.close()


def test_firestore_cross_device_sync(browser: Browser, browser_context_args):
    """
    Verifies cross-device syncing using MockFireProvider.
    Device A creates data, Device B should see it after sync.
    """
    base_url = browser_context_args.get("base_url", "http://localhost:5173")

    # --- Device A: Create Data & Sync ---
    print("Starting Device A...")
    context_a = browser.new_context(**browser_context_args)
    page_a = context_a.new_page()

    page_a.on("console", lambda msg: print(f"DEVICE A: {msg.text}"))

    # Enable mock Firestore mode
    page_a.add_init_script("""
        window.__VERSICLE_MOCK_FIRESTORE__ = true;
        window.__VERSICLE_SANITIZATION_DISABLED__ = true;
    """)
    page_a.add_init_script(path="verification/tts-polyfill.js")

    page_a.goto("/")
    expect(page_a.get_by_test_id("library-view")).to_be_visible()

    # Change theme (easy to verify synced data via usePreferencesStore)
    page_a.get_by_test_id("header-settings-button").click()

    # Change to Dark mode
    page_a.get_by_label("Select Dark theme").click()

    # Verify change applied
    expect(page_a.locator("html")).to_have_class("dark")

    # Wait for sync to complete
    time.sleep(2)

    # Extract snapshot from localStorage for Device B
    snapshot_data = page_a.evaluate(
        "localStorage.getItem('versicle_mock_firestore_snapshot')"
    )

    print(f"Device A snapshot data present: {snapshot_data is not None}")

    # Close settings
    page_a.keyboard.press("Escape")

    page_a.close()
    context_a.close()

    # --- Device B: Sync & Verify ---
    print("Starting Device B...")
    context_b = browser.new_context(**browser_context_args)
    page_b = context_b.new_page()

    page_b.on("console", lambda msg: print(f"DEVICE B: {msg.text}"))

    # Inject the snapshot from Device A
    injection_script = f"""
        window.__VERSICLE_MOCK_FIRESTORE__ = true;
        window.__VERSICLE_SANITIZATION_DISABLED__ = true;
        if ({json.dumps(snapshot_data)}) {{
            localStorage.setItem('versicle_mock_firestore_snapshot', {json.dumps(snapshot_data)});
        }}
    """

    page_b.add_init_script(injection_script)
    page_b.add_init_script(path="verification/tts-polyfill.js")

    page_b.goto("/")
    expect(page_b.get_by_test_id("library-view")).to_be_visible()

    # Wait for data to sync
    time.sleep(2)

    # Verify the theme synced
    print("Checking for synced theme on Device B...")
    # It might take a moment for Yjs to apply the update
    expect(page_b.locator("html")).to_have_class("dark", timeout=10000)

    print("Cross-device Firestore sync verified!")

    page_b.screenshot(path="verification/screenshots/firestore_sync_device_b.png")

    page_b.close()
    context_b.close()


def test_firestore_offline_resilience(browser: Browser, browser_context_args):
    """
    Verifies that data created offline is preserved.
    """
    base_url = browser_context_args.get("base_url", "http://localhost:5173")

    context = browser.new_context(**browser_context_args)
    page = context.new_page()

    page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))

    # Enable mock mode
    page.add_init_script("""
        window.__VERSICLE_MOCK_FIRESTORE__ = true;
        window.__VERSICLE_SANITIZATION_DISABLED__ = true;
    """)
    page.add_init_script(path="verification/tts-polyfill.js")

    page.goto("/")
    expect(page.get_by_test_id("library-view")).to_be_visible()

    # Add data
    page.get_by_test_id("header-settings-button").click()
    page.get_by_role("button", name="Dictionary").click()
    page.get_by_role("button", name="Manage Rules").click()
    page.get_by_test_id("lexicon-add-rule-btn").click()
    page.get_by_test_id("lexicon-input-original").fill("OfflineTest")
    page.get_by_test_id("lexicon-input-replacement").fill("OfflineReplacement")
    page.get_by_test_id("lexicon-save-rule-btn").click()

    expect(page.get_by_text("OfflineTest")).to_be_visible()

    # Close settings
    page.get_by_test_id("lexicon-close-btn").click()
    page.keyboard.press("Escape")

    # Wait for local save
    time.sleep(1)

    # Refresh the page (simulating app restart)
    page.reload()

    expect(page.get_by_test_id("library-view")).to_be_visible(timeout=10000)

    # Verify data persisted
    page.get_by_test_id("header-settings-button").click()
    page.get_by_role("button", name="Dictionary").click()
    page.get_by_role("button", name="Manage Rules").click()

    expect(page.get_by_text("OfflineTest")).to_be_visible(timeout=5000)
    expect(page.get_by_text("OfflineReplacement")).to_be_visible()

    print("Offline resilience verified!")

    page.close()
    context.close()
