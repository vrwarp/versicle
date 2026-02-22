import os
from playwright.sync_api import Page, expect
import pytest
from verification import utils

def test_orphan_repair(page: Page):
    """
    Verifies that the Maintenance Repair tool identifies and cleans orphans.
    Steps:
    1. Reset app.
    2. Upload a book to get a valid DB state.
    3. Manually inject orphaned data into IDB (file, annotation) via console.
    4. Open Settings -> Data Management.
    5. Run Repair.
    6. Verify orphans are detected and cleaned.
    """
    print("Starting Orphan Repair Verification...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Inject Orphans
    print("Injecting orphans...")
    # Using window.indexedDB directly because window.idb might not be exposed globally in the bundle
    page.evaluate("""async () => {
            // Use version 23 (current)
            const req = window.indexedDB.open('EpubLibraryDB', 23);
        req.onsuccess = (e) => {
            const db = e.target.result;
            // Target active stores for maintenance
            const tx = db.transaction(['static_resources', 'cache_render_metrics'], 'readwrite');

            // Orphaned File -> static_resources
            tx.objectStore('static_resources').put({
                bookId: 'orphan-book-id',
                epubBlob: new ArrayBuffer(10)
            });

            // Orphaned Metadata -> cache_render_metrics
            tx.objectStore('cache_render_metrics').put({
                bookId: 'orphan-book-id',
                locations: JSON.stringify({ test: true })
            });
        };
        // Wait a bit for async ops to finish
        await new Promise(r => setTimeout(r, 1000));
    }""")

    # Open Settings
    print("Opening Settings...")
    page.get_by_role("button", name="Settings").click()

    # Go to Data Management Tab
    page.get_by_role("button", name="Data Management").click()

    # Set dialog handler BEFORE clicking
    page.on("dialog", lambda dialog: dialog.accept())

    # Click "Check & Repair Database"
    print("Running Repair...")
    page.get_by_role("button", name="Check & Repair Database").click()

    # Wait for result text
    print("Waiting for completion...")

    # Wait for either success or healthy message
    try:
        success_msg = page.get_by_text("Repair complete. Orphans removed.")
        healthy_msg = page.get_by_text("Database is healthy")

        # Wait for either to appear
        expect(success_msg.or_(healthy_msg)).to_be_visible(timeout=15000)

        if healthy_msg.is_visible():
            pytest.fail("Database reported healthy, but orphans were injected. Injection likely failed.")

        success_msg.scroll_into_view_if_needed()
        expect(success_msg).to_be_visible()

    except Exception as e:
        # Capture screenshot on failure
        page.screenshot(path="verification/screenshots/maintenance_fail.png")
        raise e

    # Verify orphans are gone via IDB check
    print("Verifying cleanup...")
    orphans_exist = page.evaluate("""async () => {
        return new Promise((resolve, reject) => {
            // Use version 23
            const req = window.indexedDB.open('EpubLibraryDB', 23);
            req.onsuccess = (e) => {
                const db = e.target.result;
                const tx = db.transaction(['static_resources', 'cache_render_metrics'], 'readonly');

                let fileExists = false;
                let metricsExists = false;

                const fileReq = tx.objectStore('static_resources').get('orphan-book-id');
                fileReq.onsuccess = () => {
                    if (fileReq.result) fileExists = true;
                };

                const metricsReq = tx.objectStore('cache_render_metrics').get('orphan-book-id');
                metricsReq.onsuccess = () => {
                    if (metricsReq.result) metricsExists = true;
                };

                tx.oncomplete = () => {
                    resolve(fileExists || metricsExists);
                };
            };
        });
    }""")

    assert not orphans_exist, "Orphans should have been deleted."
    print("Orphan repair verification successful.")
