"""
Firestore Cross-Device Sync Verification Tests

Tests the end-to-end sync flow using MockFireProvider:
1. Device A imports a book and syncs to mock Firestore
2. Device B connects and receives the synced book
3. Device B restores the book file (simulates downloading on new device)

Uses window.__VERSICLE_MOCK_FIRESTORE__ to enable MockFireProvider.
"""

import pytest
from playwright.sync_api import Page, Browser, expect
import json
import time


def test_firestore_book_sync_and_restore(browser: Browser, browser_context_args):
    """
    Verifies cross-device book syncing using MockFireProvider.
    
    Scenario:
    1. Device A: Import book, verify it appears
    2. Device A: Trigger sync (MockFireProvider saves to localStorage)
    3. Device B: Load with injected mock data
    4. Device B: Verify book metadata synced (but book is offloaded)
    5. Device B: Restore the book file
    6. Device B: Verify book is no longer offloaded and can be opened
    """
    base_url = browser_context_args.get("base_url", "http://localhost:5173")

    # ============================================
    # DEVICE A: Create Data & Sync
    # ============================================
    print("\n========== DEVICE A: Import Book & Sync ==========")
    context_a = browser.new_context(**browser_context_args)
    page_a = context_a.new_page()

    # Console logging for debugging
    page_a.on("console", lambda msg: print(f"[A] {msg.text}"))
    page_a.on("pageerror", lambda err: print(f"[A ERROR] {err}"))

    # Init scripts for Device A
    page_a.add_init_script("window.__VERSICLE_MOCK_FIRESTORE__ = true;")
    page_a.add_init_script("window.__VERSICLE_SANITIZATION_DISABLED__ = true;")
    page_a.add_init_script(path="verification/tts-polyfill.js")

    # Clear any existing data first
    page_a.goto(base_url)
    page_a.evaluate("""
        async () => {
            // Clear all IndexedDB databases
            const dbs = await window.indexedDB.databases();
            for (const db of dbs) {
                await new Promise((resolve, reject) => {
                    const req = window.indexedDB.deleteDatabase(db.name);
                    req.onsuccess = resolve;
                    req.onerror = reject;
                    req.onblocked = () => { console.warn('DB blocked'); resolve(); };
                });
            }
            localStorage.clear();
        }
    """)
    page_a.reload()
    
    # Wait for app to load
    expect(page_a.get_by_test_id("library-view")).to_be_visible(timeout=15000)
    print("[A] Library view loaded")

    # Import a book
    page_a.set_input_files("data-testid=hidden-file-input", "verification/alice.epub")
    
    # Wait for book card to appear
    book_card_a = page_a.locator("[data-testid^='book-card-']").first
    expect(book_card_a).to_be_visible(timeout=15000)
    print("[A] Book imported successfully")

    # Capture the book title for verification
    book_title = page_a.locator("[data-testid='book-title']").first.text_content()
    print(f"[A] Book title: {book_title}")

    # Wait for sync to complete (MockFireProvider debounces saves)
    time.sleep(2)

    # Force a final sync by triggering an update
    page_a.evaluate("""
        // Trigger a dummy state change to ensure sync
        window.dispatchEvent(new Event('beforeunload'));
    """)
    time.sleep(1)

    # Extract the mock Firestore snapshot from localStorage
    mock_data_str = page_a.evaluate("localStorage.getItem('versicle_mock_firestore_snapshot')")
    assert mock_data_str is not None, "Device A failed to sync data to mock Firestore storage"
    
    # Parse and verify the snapshot
    mock_data = json.loads(mock_data_str)
    print(f"[A] Mock Firestore data keys: {list(mock_data.keys())}")
    
    # The path should be users/mock-user/versicle/main
    sync_path = "users/mock-user/versicle/main"
    assert sync_path in mock_data, f"Expected path '{sync_path}' not found in mock data"
    
    snapshot_b64 = mock_data[sync_path].get("snapshotBase64")
    assert snapshot_b64, "Snapshot base64 is empty"
    print(f"[A] Snapshot size: {len(snapshot_b64)} chars")

    # Close Device A
    page_a.close()
    context_a.close()
    print("[A] Device A closed")

    # ============================================
    # DEVICE B: Load Synced Data & Verify
    # ============================================
    print("\n========== DEVICE B: Load Synced Data ==========")
    context_b = browser.new_context(**browser_context_args)
    page_b = context_b.new_page()

    # Console logging for Device B
    page_b.on("console", lambda msg: print(f"[B] {msg.text}"))
    page_b.on("pageerror", lambda err: print(f"[B ERROR] {err}"))

    # Injection script: Set up mock Firestore with Device A's data
    injection_script = f"""
        window.__VERSICLE_MOCK_FIRESTORE__ = true;
        window.__VERSICLE_SANITIZATION_DISABLED__ = true;
        localStorage.setItem('versicle_mock_firestore_snapshot', {json.dumps(mock_data_str)});
    """
    page_b.add_init_script(injection_script)
    page_b.add_init_script(path="verification/tts-polyfill.js")

    # Navigate to app (fresh device - no local IndexedDB)
    page_b.goto(base_url)
    
    # Wait for app to load and sync to apply
    expect(page_b.get_by_test_id("library-view")).to_be_visible(timeout=15000)
    print("[B] Library view loaded")

    # Verify the mock data was injected (check existence, not exact equality as app may have updated it)
    injected = page_b.evaluate("localStorage.getItem('versicle_mock_firestore_snapshot')")
    assert injected is not None, "Device B failed to inject mock data (None)"
    assert len(injected) > 0, "Device B mock data is empty"
    print("[B] Mock data injection verified (present)")
    
    # Wait for Yjs sync to apply the book inventory
    # Poll for the book card to appear (synced metadata)
    for i in range(20):
        book_cards = page_b.locator("[data-testid^='book-card-']").count()
        
        # Debug: Check Yjs document state directly
        debug_info = page_b.evaluate("""
            () => {
                try {
                    const yDoc = window.__YJS_DOC__;
                    if (!yDoc) return { error: 'No global yDoc' };
                    
                    const libraryMap = yDoc.getMap('library');
                    if (!libraryMap) return { error: 'No library map' };
                    
                    // Get the books value - could be a Y.Map or plain object
                    const books = libraryMap.get('books');
                    let booksObj = {};
                    
                    if (books) {
                        if (books.toJSON) {
                            booksObj = books.toJSON();
                        } else if (typeof books === 'object') {
                            booksObj = books;
                        }
                    }
                    
                    return {
                        libraryKeys: Array.from(libraryMap.keys()),
                        booksType: books ? books.constructor.name : 'undefined',
                        bookIds: Object.keys(booksObj),
                        booksRaw: JSON.stringify(booksObj).slice(0, 500)
                    };
                } catch (e) {
                    return { error: e.message };
                }
            }
        """)
        
        print(f"[B] Polling attempt {i+1}: {book_cards} cards, debug: {debug_info}")
        if book_cards > 0:
            break
        time.sleep(0.5)
    
    # Verify the book appears
    book_card_b = page_b.locator("[data-testid^='book-card-']").first
    expect(book_card_b).to_be_visible(timeout=10000)
    print("[B] Synced book card visible!")

    # Verify the book title matches
    synced_title = page_b.locator("[data-testid='book-title']").first.text_content()
    print(f"[B] Synced book title: {synced_title}")
    assert book_title == synced_title, f"Title mismatch: expected '{book_title}', got '{synced_title}'"

    # The book should be marked as offloaded (no local file)
    # Check for the offload indicator (cloud icon overlay)
    offload_indicator = page_b.locator(".bg-black\\/20")
    expect(offload_indicator).to_be_visible(timeout=5000)
    print("[B] Book correctly shows as offloaded (cloud icon visible)")

    # ============================================
    # DEVICE B: Restore Book File
    # ============================================
    print("\n========== DEVICE B: Restore Book File ==========")

    # Click on the offloaded book (should trigger restore flow)
    book_card_b.click()

    # The restore flow should open a file picker
    # We need to provide the file via the restore file input
    # First, wait for the file input to be ready
    time.sleep(1)
    
    # Set the file for restore
    page_b.set_input_files("data-testid=restore-file-input", "verification/alice.epub")
    
    # Wait for import to complete
    time.sleep(3)

    # After restore, the offload indicator should be gone
    expect(offload_indicator).not_to_be_visible(timeout=10000)
    print("[B] Book restored - offload indicator gone!")

    # Verify we can open the book now
    book_card_b.click()
    expect(page_b.get_by_test_id("reader-iframe-container")).to_be_visible(timeout=10000)
    print("[B] Book opens successfully after restore!")

    # Cleanup
    page_b.close()
    context_b.close()
    print("\n========== TEST PASSED: Cross-device Firestore sync verified! ==========")


def test_firestore_sync_offload_status_hydration(browser: Browser, browser_context_args):
    """
    Verifies that when syncing from Firestore, books without local content
    are correctly marked as offloaded in the UI.
    
    This tests the hydration logic in LibraryView that detects new synced books.
    """
    base_url = browser_context_args.get("base_url", "http://localhost:5173")

    # ============================================
    # DEVICE A: Import book & Sync
    # ============================================
    print("\n========== DEVICE A: Import Book ==========")
    context_a = browser.new_context(**browser_context_args)
    page_a = context_a.new_page()

    page_a.on("console", lambda msg: print(f"[A] {msg.text}"))

    page_a.add_init_script("window.__VERSICLE_MOCK_FIRESTORE__ = true;")
    page_a.add_init_script("window.__VERSICLE_SANITIZATION_DISABLED__ = true;")
    page_a.add_init_script(path="verification/tts-polyfill.js")

    # Clear data
    page_a.goto(base_url)
    page_a.evaluate("""
        async () => {
            const dbs = await window.indexedDB.databases();
            for (const db of dbs) {
                await new Promise((resolve) => {
                    const req = window.indexedDB.deleteDatabase(db.name);
                    req.onsuccess = resolve;
                    req.onerror = resolve;
                    req.onblocked = resolve;
                });
            }
            localStorage.clear();
        }
    """)
    page_a.reload()

    expect(page_a.get_by_test_id("library-view")).to_be_visible(timeout=15000)

    # Import book
    page_a.set_input_files("data-testid=hidden-file-input", "verification/alice.epub")
    book_card_a = page_a.locator("[data-testid^='book-card-']").first
    expect(book_card_a).to_be_visible(timeout=15000)
    
    # Let sync complete
    time.sleep(2)
    page_a.evaluate("window.dispatchEvent(new Event('beforeunload'));")
    time.sleep(1)

    # Get snapshot
    mock_data_str = page_a.evaluate("localStorage.getItem('versicle_mock_firestore_snapshot')")
    assert mock_data_str is not None, "Device A sync failed"

    page_a.close()
    context_a.close()

    # ============================================
    # DEVICE B: Verify offload status
    # ============================================
    print("\n========== DEVICE B: Verify Offload Status ==========")
    context_b = browser.new_context(**browser_context_args)
    page_b = context_b.new_page()

    page_b.on("console", lambda msg: print(f"[B] {msg.text}"))

    injection_script = f"""
        window.__VERSICLE_MOCK_FIRESTORE__ = true;
        window.__VERSICLE_SANITIZATION_DISABLED__ = true;
        localStorage.setItem('versicle_mock_firestore_snapshot', {json.dumps(mock_data_str)});
    """
    page_b.add_init_script(injection_script)
    page_b.add_init_script(path="verification/tts-polyfill.js")

    page_b.goto(base_url)
    expect(page_b.get_by_test_id("library-view")).to_be_visible(timeout=15000)

    # Wait for sync
    for i in range(20):
        if page_b.locator("[data-testid^='book-card-']").count() > 0:
            break
        time.sleep(0.5)

    book_card_b = page_b.locator("[data-testid^='book-card-']").first
    expect(book_card_b).to_be_visible(timeout=10000)

    # Verify offload indicator is present
    offload_indicator = page_b.locator(".bg-black\\/20")
    expect(offload_indicator).to_be_visible(timeout=5000)
    print("[B] Offload status correctly hydrated!")

    page_b.close()
    context_b.close()
    print("\n========== TEST PASSED: Offload status hydration verified! ==========")


def test_firestore_offline_resilience(browser: Browser, browser_context_args):
    """
    Verifies that data created offline persists after refresh.
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

    page.goto(base_url)
    expect(page.get_by_test_id("library-view")).to_be_visible(timeout=15000)

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
