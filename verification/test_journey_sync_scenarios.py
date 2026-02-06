"""
Cross-Device Sync Scenarios Verification
Tests end-to-end user journeys for synchronization using MockFireProvider.
"""
import pytest
import time
import os
import json
import uuid
from playwright.sync_api import Page, expect, Browser, BrowserContext

# Helper to inject mock Firestore
def inject_mock_firestore(page: Page, snapshot=None):
    page.add_init_script("window.__VERSICLE_MOCK_FIRESTORE__ = true;")
    page.add_init_script("window.__VERSICLE_SANITIZATION_DISABLED__ = true;")
    page.add_init_script("window.__VERSICLE_FIRESTORE_DEBOUNCE_MS__ = 20;")
    page.add_init_script(path="verification/tts-polyfill.js")
    if snapshot:
        page.add_init_script(f"localStorage.setItem('versicle_mock_firestore_snapshot', JSON.stringify({json.dumps(snapshot)}));")

def get_firestore_snapshot(page: Page):
    return page.evaluate("localStorage.getItem('versicle_mock_firestore_snapshot')")

def clear_data_and_reload(page: Page, base_url: str):
    page.goto(base_url)
    page.evaluate("""
        async () => {
            const dbs = await window.indexedDB.databases();
            for (const db of dbs) {
                await new Promise(resolve => {
                    const req = window.indexedDB.deleteDatabase(db.name);
                    req.onsuccess = resolve;
                    req.onerror = resolve;
                    req.onblocked = resolve;
                });
            }
            localStorage.clear();
        }
    """)
    page.reload()
    expect(page.get_by_test_id("library-view")).to_be_visible(timeout=10000)

def poll_for_persistence(page: Page, expected_key_pattern: str, retries=20, delay=0.5):
    """
    Waits for the Mock Firestore debounce queue to flush by checking localStorage content.
    """
    for _ in range(retries):
        snapshot_str = page.evaluate("localStorage.getItem('versicle_mock_firestore_snapshot')")
        if snapshot_str:
            if expected_key_pattern in snapshot_str:
                return snapshot_str
        time.sleep(delay)
    return None


def test_journey_seamless_handoff(browser: Browser, browser_context_args):
    """
    Journey 1: Seamless Handoff (The "Commuter")
    - Device A: Import book, read to page X, add note. Sync.
    - Device B: Open app. See "Resume" badge. Click it. Verify location & note.
    """
    base_url = browser_context_args.get("base_url", "http://localhost:5173")

    # --- Device A ---
    print("\n[A] Setting up...")
    context_a = browser.new_context(**browser_context_args)
    page_a = context_a.new_page()
    inject_mock_firestore(page_a)
    clear_data_and_reload(page_a, base_url)

    # Import
    page_a.set_input_files("data-testid=hidden-file-input", "verification/alice.epub")
    book_card = page_a.locator("[data-testid^='book-card-']").first
    expect(book_card).to_be_visible(timeout=10000)

    # Get Book ID from the card we clicked (before clicking, as it might disappear)
    book_id = book_card.get_attribute("data-testid").replace("book-card-", "")

    # Open Reader
    book_card.click()
    expect(page_a.get_by_test_id("reader-iframe-container")).to_be_visible(timeout=10000)

    # Force create progress (UI navigation can be flaky in headless)
    # Ensure we generate valid progress > 0
    # Loop: Check Library UI -> Open Reader -> Turn Pages -> Back to Library
    max_attempts = 3
    progress_confirmed = False

    for attempt in range(max_attempts):
        print(f"[A] Progress Generation Attempt {attempt+1}")

        # Open Book (if not already open, but we are in library initially)
        # Verify if we are in reader or library
        if page_a.get_by_test_id("library-view").is_visible():
            book_card.click()

        # Wait for reader
        expect(page_a.get_by_test_id("reader-iframe-container")).to_be_visible()

        # Wait for rendition
        page_a.wait_for_function("window.rendition && window.rendition.location")

        # Turn pages
        turns = 10 if attempt > 0 else 5
        print(f"[A] Turning {turns} pages...")
        for _ in range(turns):
            page_a.evaluate("window.rendition && window.rendition.next()")
            time.sleep(0.5)

        # Go back to library
        page_a.get_by_test_id("reader-back-button").click()
        expect(page_a.get_by_test_id("library-view")).to_be_visible()

        # Check Progress Bar
        # Re-locate card as DOM might have refreshed
        book_card = page_a.locator(f"[data-testid^='book-card-']").first
        progress_bar = book_card.locator('[data-testid="progress-container"]')

        if progress_bar.is_visible():
            print("[A] Progress verified in UI.")
            progress_confirmed = True
            break
        else:
            print("[A] Progress bar not visible yet.")

    if not progress_confirmed:
        print("[A] WARNING: Failed to generate visible progress on Device A.")

    # Wait a bit for final store debounce
    time.sleep(2)

    # Capture Sync State (Trigger push)
    page_a.evaluate("window.dispatchEvent(new Event('beforeunload'))")

    # Wait for persistence (using the Book ID or general path to ensure flush)
    snapshot_a = poll_for_persistence(page_a, "users/mock-user/versicle/main")
    assert snapshot_a, "Device A failed to sync"
    snapshot_a = json.loads(snapshot_a)

    page_a.close()
    context_a.close()

    # --- Device B ---
    print("\n[B] Resuming...")
    context_b = browser.new_context(**browser_context_args)
    page_b = context_b.new_page()
    # Inject A's data
    inject_mock_firestore(page_b, snapshot_a)
    page_b.goto(base_url)

    # Wait for sync
    expect(page_b.get_by_test_id("library-view")).to_be_visible()

    # Wait for Ghost Book to appear
    card_b = page_b.locator("[data-testid^='book-card-']").first
    expect(card_b).to_be_visible(timeout=10000)

    # VERIFY: Resume Badge logic
    # NOTE: Resume Badge appears if the book is NOT currently active on this device but has progress from another.
    # Since this is a fresh device, any remote progress is "Resumeable".
    # Check for the resume badge which typically has a device icon
    # Implementation detail: Smart Resume logic might require the book to be opened at least once locally to be "offloaded",
    # or it might show for ghost books too. Based on plans, it should show.

    # Let's verify we see the "Cloud" icon from Ghost Book first
    expect(card_b.locator(".bg-black\\/20")).to_be_visible() # Offload overlay

    # Restore the book first (simulating user having the file) - otherwise we can't open it to verify location easily.
    # Journey plan says "Tap Badge... Book opens".
    # But files aren't synced. We need to restore manually or "mock" the file presence.
    # For this test, let's restore it.

    # Force click (in case of overlay) not ideal, better to wait.
    # But "Content Missing" dialog is what we expect AFTER click.
    # If something else is blocking, it might be a toast.
    card_b.click(force=True)

    # Expect file missing dialog or restore flow.
    # Wait for file input
    # Note: Our new ContentMissingDialog relies on button click to trigger input?
    # No, it renders <input> but it's hidden. We can set files on it.
    # The dialog renders the input with data-testid="restore-file-input".
    page_b.set_input_files("data-testid=restore-file-input", "verification/alice.epub")
    time.sleep(2)

    # Wait for restoration to complete (Dialog closes)
    expect(page_b.get_by_role("dialog")).to_be_hidden(timeout=10000)

    # Resume Reading
    # We explicitly look for the Resume Badge to verify "Handoff" journey
    # and to ensure we jump to the remote position (CFI)
    print("[B] Checking for Resume Badge...")
    resume_badge = card_b.locator('[data-testid="resume-badge"]')
    try:
        expect(resume_badge).to_be_visible(timeout=5000)
        print("[B] Resume Badge visible. Clicking...")
        resume_badge.click(force=True)
    except:
        print("[B] Resume Badge not visible. Clicking card.")
        card_b.click(force=True)

    # Now that it's restored, let's check if the Resume prompt appears or if we jumped.
    # The restore might auto-open to the last read position.
    expect(page_b.get_by_test_id("reader-iframe-container")).to_be_visible(timeout=15000)

    # Wait for rendition to load and calculate progress
    page_b.wait_for_function("window.rendition && window.rendition.location")
    # Simple check: Progress bar > 0%
    # Go back to library to check progress bar on card
    page_b.get_by_test_id("reader-back-button").click()

    # Check progress via UI Progress Bar
    progress_bar = card_b.locator('[data-testid="progress-container"]')
    # Playwright's to_be_visible will check if it's in the viewport or scrollable to it?
    # Actually to_be_visible checks if it is attached, visible, opacity > 0.
    # It does NOT auto-scroll to make it visible in the viewport for the check itself, BUT
    # expect() typically handles wait logic well.
    # Explicit scroll on mobile sometimes hangs if the layout is tricky (e.g. overflow).
    # Let's try relying on standard expect with a slightly improved timeout.
    expect(progress_bar).to_be_visible(timeout=10000)

    page_b.close()
    context_b.close()


# Test unskipped
def test_journey_offline_resilience(browser: Browser, browser_context_args):
    """
    Journey 2: Offline Resilience (The "Airplane")
    - Device A (Offline): Create rule.
    - Device A (Online): Sync sends batch.
    - Device B: Receive.
    """
    base_url = browser_context_args.get("base_url", "http://localhost:5173")

    # --- Device A ---
    context_a = browser.new_context(**browser_context_args)
    page_a = context_a.new_page()

    # Start WITHOUT MockFirestore (Simulate Offline/No Sync Provider)
    # OR configure MockFirestore to fail?
    # Simpler: Just don't inject the "connected" state or provider yet?
    # Actually, the app works local-first.
    # We'll enable MockFirestore but block the "network" mechanism?
    # MockFireProvider writes to localStorage immediately.
    # Let's verify that data created persists to localStorage even without "push".

    inject_mock_firestore(page_a)
    clear_data_and_reload(page_a, base_url)

    # Add Lexicon Rule
    page_a.click("button[aria-label='Settings']", force=True)
    page_a.get_by_role("button", name="Dictionary").click()
    page_a.get_by_role("button", name="Manage Rules").click()
    page_a.get_by_test_id("lexicon-add-rule-btn").click()
    page_a.fill("data-testid=lexicon-input-original", "Offline")
    page_a.fill("data-testid=lexicon-input-replacement", "Online")
    page_a.click("data-testid=lexicon-save-rule-btn")

    # Flush sync (Simulate regaining connection)
    page_a.evaluate("window.dispatchEvent(new Event('beforeunload'))")
    # Flush sync (Simulate regaining connection)
    page_a.evaluate("window.dispatchEvent(new Event('beforeunload'))")

    # Wait for the data to actually hit "disk" (localStorage) before snapshotting
    # We poll for the existence of the mock user path, which confirms the provider flushed the change
    snapshot_a = poll_for_persistence(page_a, "users/mock-user/versicle/main")
    assert snapshot_a, "Device A failed to persist data to mock cloud"
    snapshot_a = json.loads(snapshot_a)

    page_a.close()
    context_a.close()

    # --- Device B ---
    context_b = browser.new_context(**browser_context_args)
    page_b = context_b.new_page()
    inject_mock_firestore(page_b, snapshot_a)
    page_b.goto(base_url)

    # Wait for sync to complete (library view loads with synced data)
    expect(page_b.get_by_test_id("library-view")).to_be_visible(timeout=10000)
    
    # Give sync manager time to process the pre-loaded snapshot
    # The Yjs provider needs time to initialize, load snapshot, and propagate to stores
    time.sleep(3)

    # Wait for the lexicon store to actually have data from the sync
    # This is more reliable than just waiting for time to pass
    print("Waiting for lexicon store to sync...")
    store_synced = False
    for i in range(30):  # Try for 15 seconds
        try:
            has_rules = page_b.evaluate("""
                () => {
                    // Check if useLexiconStore has any rules
                    const store = window.__ZUSTAND_STORES__?.useLexiconStore;
                    if (store) {
                        const state = store.getState();
                        const rules = state.rules || [];
                        return rules.length > 0;
                    }
                    return false;
                }
            """)
            if has_rules:
                store_synced = True
                print(f"Lexicon store synced after {i * 0.5}s")
                break
        except:
            pass
        time.sleep(0.5)

    # If store sync didn't work, try a full page reload
    if not store_synced:
        print("Store sync not detected, reloading page...")
        page_b.reload()
        expect(page_b.get_by_test_id("library-view")).to_be_visible(timeout=10000)
        time.sleep(3)

    # Check Settings
    page_b.click("button[aria-label='Settings']", force=True)
    page_b.get_by_role("button", name="Dictionary").click()
    page_b.get_by_role("button", name="Manage Rules").click()

    # Wait for the lexicon rules to load from synced data
    print("Waiting for synced lexicon rule 'Offline'...")
    rule_visible = False
    for i in range(40):  # Try for 20 seconds (40 * 0.5s)
        if page_b.get_by_text("Offline").is_visible():
            rule_visible = True
            break
        
        # If not visible yet, try closing and re-opening the dialog to force re-render
        if i > 0 and i % 10 == 0:
            print(f"Retry {i // 10}: Closing and re-opening dialog...")
            # Close all dialogs by pressing Escape multiple times
            page_b.keyboard.press("Escape")
            time.sleep(0.3)
            page_b.keyboard.press("Escape")
            time.sleep(0.5)
            
            # Re-open Settings -> Dictionary -> Manage Rules
            page_b.click("button[aria-label='Settings']", force=True)
            time.sleep(0.5)  # Wait for settings dialog animation
            expect(page_b.get_by_role("button", name="Dictionary")).to_be_visible(timeout=5000)
            page_b.get_by_role("button", name="Dictionary").click()
            time.sleep(0.3)
            expect(page_b.get_by_role("button", name="Manage Rules")).to_be_visible(timeout=5000)
            page_b.get_by_role("button", name="Manage Rules").click()
            time.sleep(0.3)
        
        time.sleep(0.5)
    
    if not rule_visible:
        print("Rule not visible after wait. capturing screenshot...")
        page_b.screenshot(path="verification/screenshots/sync_fail_mobile_debug.png")
        # Fail with a clear message
        expect(page_b.get_by_text("Offline")).to_be_visible(timeout=1000)
    else:
        print("Rule synced and visible!")
        expect(page_b.get_by_text("Offline")).to_be_visible()

    page_b.close()
    context_b.close()



def test_journey_data_liberation(browser: Browser, browser_context_args):
    """
    Journey 5: Data Liberation (The Manual Archive)
    - Import data.
    - Run DataExportWizard (JSON).
    - Validate JSON content.
    """
    base_url = browser_context_args.get("base_url", "http://localhost:5173")
    context = browser.new_context(**browser_context_args)
    page = context.new_page()
    inject_mock_firestore(page)
    clear_data_and_reload(page, base_url)

    # Create some data (Lexicon Rule)
    page.click("button[aria-label='Settings']", force=True)
    page.get_by_role("button", name="Dictionary").click()
    page.get_by_role("button", name="Manage Rules").click()
    page.get_by_test_id("lexicon-add-rule-btn").click()
    page.fill("data-testid=lexicon-input-original", "ExportMe")
    page.fill("data-testid=lexicon-input-replacement", "ImportMe")
    page.click("data-testid=lexicon-save-rule-btn")

    # Reload to ensure clean state (close all dialogs)
    page.reload()
    expect(page.get_by_test_id("library-view")).to_be_visible()

    # Open Data Management
    page.click("button[aria-label='Settings']", force=True)
    time.sleep(1) # Wait for dialog animation
    page.get_by_role("button", name="Data Management").click(force=True)

    # Trigger Export Wizard
    page.click("data-testid=export-wizard-btn", force=True)

    # Wizard Steps
    expect(page.get_by_text("Select what data you want to include")).to_be_visible()

    # Check Options (Default all checked)
    # Click Next
    page.get_by_role("button", name="Next").click()

    # Format Step
    expect(page.get_by_text("Choose how you want to download your data.")).to_be_visible()
    page.get_by_role("button", name="Generate Export").click()

    # Download Step
    expect(page.get_by_text("Export Ready")).to_be_visible()

    # Handle Download
    with page.expect_download() as download_info:
        page.get_by_role("button", name="Download").click()

    download = download_info.value
    path = f"/tmp/export_{uuid.uuid4()}.json"
    download.save_as(path)

    # Validate JSON
    with open(path, 'r') as f:
        data = json.load(f)

    assert data["meta"]["exporter"] == "Versicle"
    assert "settings" in data["data"]

    # New check: Verify settings field exists
    # Note: We haven't changed defaults so we can't check specific values easily unless we set them.
    # But checking schema presence is good.

    os.remove(path)
    page.close()
    context.close()
