
import os
import shutil
import time
from playwright.sync_api import sync_playwright, expect

def verify_legacy_bypass():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        try:
            # 1. Navigate to the app
            page.goto("http://localhost:5173")

            # Wait for app to load
            try:
                expect(page.get_by_text("Library", exact=True).or_(page.get_by_text("Your library is empty"))).to_be_visible(timeout=10000)
            except:
                page.screenshot(path="verification/debug_legacy_load_fail.png")
                raise

            # 2. Inject a legacy book (tablesProcessed=true, no version)
            mock_book_id = "test-legacy-book"

            page.evaluate("""
                async () => {
                    const dbName = 'EpubLibraryDB';
                    const request = indexedDB.open(dbName);

                    return new Promise((resolve, reject) => {
                        request.onsuccess = async (event) => {
                            const db = event.target.result;
                            const tx = db.transaction(['books', 'files'], 'readwrite');

                            // Insert a dummy file
                            const fileStore = tx.objectStore('files');
                            await fileStore.put(new Blob(['dummy content'], {type: 'application/epub+zip'}), '${mock_book_id}');

                            // Insert legacy book metadata
                            const bookStore = tx.objectStore('books');
                            await bookStore.put({
                                id: '${mock_book_id}',
                                title: 'Legacy Book',
                                author: 'Test Author',
                                addedAt: Date.now(),
                                // version is undefined
                                tablesProcessed: true, // Legacy flag should signal version 1
                                filename: 'test.epub'
                            });

                            tx.oncomplete = () => resolve(true);
                            tx.onerror = () => reject(tx.error);
                        };
                        request.onerror = () => reject(request.error);
                    });
                }
            """)

            print("Injected legacy book.")

            page.reload()
            expect(page.get_by_text("Legacy Book")).to_be_visible()

            # 3. Open the book
            page.get_by_text("Legacy Book").click()

            # 4. Expect NO Reprocessing Interstitial
            # Should go straight to Reader

            # Check for interstitial appearing (should not)
            try:
                interstitial = page.get_by_text("Enhancing Book Layout")
                if interstitial.is_visible(timeout=2000):
                     raise Exception("Interstitial appeared for legacy book!")
            except:
                pass # Good, not visible or timed out waiting for it

            # Wait for reader view
            expect(page.get_by_test_id("reader-view")).to_be_visible(timeout=10000)
            print("Reader view loaded successfully (Bypassed reprocessing).")

            # Take screenshot
            page.screenshot(path="verification/legacy_bypass.png")

        finally:
            browser.close()

if __name__ == "__main__":
    verify_legacy_bypass()
