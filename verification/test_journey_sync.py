
import pytest
from playwright.sync_api import Page, Browser, expect
import json
import time

def test_cross_device_sync_journey(browser: Browser, browser_context_args):
    """
    Verifies the cross-device syncing journey using the MockDriveProvider.
    Simulates Device A pushing data, and Device B pulling it.
    """
    base_url = browser_context_args.get("base_url", "http://localhost:5173")

    # --- Device A: Create Data & Sync ---
    print("Starting Device A...")
    context_a = browser.new_context(**browser_context_args)
    page_a = context_a.new_page()

    # Enable console logs for Device A
    page_a.on("console", lambda msg: print(f"PAGE A LOG: {msg.text}"))

    # Init Scripts
    page_a.add_init_script("window.__VERSICLE_MOCK_SYNC__ = true;")
    page_a.add_init_script("window.__VERSICLE_SANITIZATION_DISABLED__ = true;")
    page_a.add_init_script(path="verification/tts-polyfill.js")

    page_a.goto("/")
    expect(page_a.get_by_test_id("library-view")).to_be_visible()

    # Enable Sync on A
    page_a.get_by_test_id("header-settings-button").click()
    page_a.get_by_role("button", name="Sync & Cloud").click()
    time.sleep(1)
    page_a.get_by_placeholder("OAuth2 Client ID").fill("device-a")
    page_a.get_by_placeholder("API Key").fill("key-a")
    page_a.get_by_role("switch").click()

    # Add Lexicon Rule on A
    page_a.get_by_role("button", name="Dictionary").click()
    page_a.get_by_role("button", name="Manage Rules").click()
    page_a.get_by_test_id("lexicon-add-rule-btn").click()
    page_a.get_by_test_id("lexicon-input-original").fill("SyncTestWord")
    page_a.get_by_test_id("lexicon-input-replacement").fill("SyncTestReplacement")
    page_a.get_by_test_id("lexicon-save-rule-btn").click()

    # Verify it appears in list
    expect(page_a.get_by_text("SyncTestWord")).to_be_visible()

    # Close Lexicon and Settings
    page_a.get_by_test_id("lexicon-close-btn").click()
    page_a.keyboard.press("Escape")

    # DEBUG: Check DB content on Device A
    db_count = page_a.evaluate("""
        async () => {
            const req = window.indexedDB.open('EpubLibraryDB', 21);
            return new Promise((resolve, reject) => {
                req.onsuccess = (event) => {
                    const db = event.target.result;
                    const database = event.target.result;
                    const tx = database.transaction(['user_overrides'], 'readonly');
                    const store = tx.objectStore('user_overrides');
                    const request = store.get('global');
                    request.onsuccess = () => resolve(request.result ? request.result.lexicon.length : 0);
                    request.onerror = () => reject(request.error);
                };
                req.onerror = () => reject(req.error);
            });
        }
    """)
    print(f"Device A DB Lexicon Count: {db_count}")

    # Trigger Sync (Force Push via visibility change)
    print("Triggering sync on Device A...")
    # Mock document.hidden to be true to satisfy SyncOrchestrator check
    page_a.evaluate("""
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    """)

    # Wait for sync to likely complete
    time.sleep(2)

    # Extract Cloud State
    mock_data_str = page_a.evaluate("localStorage.getItem('versicle_mock_drive_data')")
    assert mock_data_str is not None, "Device A failed to sync data to mock storage"

    # Debug: Inspect Payload
    try:
        mock_data = json.loads(mock_data_str)
        manifest = mock_data.get("manifest", {})
        lexicon = manifest.get("lexicon", [])
        print(f"Device A Pushed Manifest Version: {manifest.get('version')}")
        print(f"Device A Pushed Lexicon Rules: {len(lexicon)}")
        if len(lexicon) > 0:
            print(f"First Rule: {lexicon[0]}")

        # Assertion to ensure we are actually testing something
        assert len(lexicon) > 0, "Device A synced successfully but the payload contained 0 lexicon rules!"

    except json.JSONDecodeError:
        pytest.fail("Failed to parse mock drive data as JSON")

    page_a.close()
    context_a.close()

    # --- Device B: Restore & Verify ---
    print("Starting Device B (Restore)...")
    context_b = browser.new_context(**browser_context_args)
    page_b = context_b.new_page()

    # Enable console logs for Device B
    page_b.on("console", lambda msg: print(f"PAGE B LOG: {msg.text}"))

    # Correctly injecting the JSON string back into localStorage
    # We use mock_data_str directly which is the raw JSON string
    injection_script = f"""
        window.__VERSICLE_MOCK_SYNC__ = true;
        window.__VERSICLE_SANITIZATION_DISABLED__ = true;
        localStorage.setItem('versicle_mock_drive_data', {json.dumps(mock_data_str)});
    """

    page_b.add_init_script(injection_script)
    page_b.add_init_script(path="verification/tts-polyfill.js")

    page_b.goto("/")
    expect(page_b.get_by_test_id("library-view")).to_be_visible()

    # Verify Injection
    injected = page_b.evaluate("localStorage.getItem('versicle_mock_drive_data')")
    assert injected == mock_data_str, "Device B failed to inject mock data correctly"
    print("Device B injection verified.")

    # Enable Sync on B (to trigger pull)
    page_b.get_by_test_id("header-settings-button").click()
    page_b.get_by_role("button", name="Sync & Cloud").click()
    time.sleep(1)

    sync_switch = page_b.get_by_role("switch")
    if sync_switch.get_attribute("aria-checked") == "false":
        page_b.get_by_placeholder("OAuth2 Client ID").fill("device-b")
        page_b.get_by_placeholder("API Key").fill("key-b")
        sync_switch.click()
        print("Device B sync enabled.")

    # Wait for initial pull.
    # We can poll DB instead of sleeping
    print("Waiting for sync to apply...")
    for i in range(10):
        # Check IndexedDB 'user_overrides' store (key: global)
        rule_count = page_b.evaluate("""
            async () => {
                const req = window.indexedDB.open('EpubLibraryDB', 21);
                return new Promise((resolve, reject) => {
                    req.onsuccess = (event) => {
                        const database = event.target.result;
                        const tx = database.transaction(['user_overrides'], 'readonly');
                        const store = tx.objectStore('user_overrides');
                        const request = store.get('global');
                        request.onsuccess = () => resolve(request.result ? request.result.lexicon.length : 0);
                        request.onerror = () => reject(request.error);
                    };
                    req.onerror = () => reject(req.error);
                });
            }
        """)
        print(f"Device B Lexicon Count: {rule_count}")
        if rule_count > 0:
            break
        time.sleep(1)

    # Verify Data Restored in UI
    page_b.get_by_role("button", name="Dictionary").click()
    page_b.get_by_role("button", name="Manage Rules").click()

    print("Verifying restored data on Device B UI...")
    expect(page_b.get_by_text("SyncTestWord")).to_be_visible()
    expect(page_b.get_by_text("SyncTestReplacement")).to_be_visible()

    print("Cross-device sync verified successfully!")

    page_b.close()
    context_b.close()
