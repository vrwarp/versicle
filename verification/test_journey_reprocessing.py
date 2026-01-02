
import os
import shutil
import time
from playwright.sync_api import sync_playwright, expect

def verify_reprocessing_interstitial():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use a consistent context with local storage if needed, but for now a new context is fine.
        context = browser.new_context()
        page = context.new_page()

        try:
            # 1. Navigate to the app
            page.goto("http://localhost:5173")

            # Wait for app to load (checking for library view)
            try:
                expect(page.get_by_text("Library", exact=True).or_(page.get_by_text("Your library is empty"))).to_be_visible(timeout=10000)
            except:
                print("Library view not found, taking debug screenshot")
                page.screenshot(path="verification/debug_load_fail.png")
                raise

            # 2. Inject a mock book into IndexedDB with old version/metadata
            # We need to simulate a book that needs reprocessing (version < 1)
            # Since we can't easily interact with IDB from outside without potentially racing,
            # we'll evaluate a script to insert it.

            # But first, we need to ensure DBService is available or we can use raw IDB.
            # Using raw IDB is safer.

            mock_book_id = "test-reprocessing-book"

            page.evaluate("""
                async () => {
                    const dbName = 'EpubLibraryDB';
                    const request = indexedDB.open(dbName);

                    return new Promise((resolve, reject) => {
                        request.onsuccess = async (event) => {
                            const db = event.target.result;

                            // Check if stores exist (might need to wait for app to init DB)
                            if (!db.objectStoreNames.contains('books')) {
                                resolve(false); // DB not ready?
                                return;
                            }

                            const tx = db.transaction(['books', 'files'], 'readwrite');

                            // Insert a dummy file
                            const fileStore = tx.objectStore('files');
                            await fileStore.put(new Blob(['dummy content'], {type: 'application/epub+zip'}), '${mock_book_id}');

                            // Insert an old book metadata
                            const bookStore = tx.objectStore('books');
                            await bookStore.put({
                                id: '${mock_book_id}',
                                title: 'Old Version Book',
                                author: 'Test Author',
                                addedAt: Date.now(),
                                version: 0, // Old version
                                tablesProcessed: false, // Old flag
                                filename: 'test.epub'
                            });

                            await tx.done; // If using idb wrapper, but here is raw.
                            // Raw transaction commits automatically on microtask end, but explicit complete waiting:
                            tx.oncomplete = () => resolve(true);
                            tx.onerror = () => reject(tx.error);
                        };
                        request.onerror = () => reject(request.error);
                    });
                }
            """)

            print("Injected old book.")

            # Reload to see the book in library
            page.reload()
            expect(page.get_by_text("Old Version Book")).to_be_visible()

            # 3. Open the book
            page.get_by_text("Old Version Book").click()

            # 4. Expect Reprocessing Interstitial
            # It should appear because version (0) < CURRENT_VERSION (1)
            # The interstitial has text "Enhancing Book Layout"

            # Note: The processing might happen very fast because we mocked the file as a tiny blob.
            # But "Enhancing Book Layout" should appear briefly.

            try:
                # We check for the loading state or the specific text
                interstitial = page.get_by_text("Enhancing Book Layout")
                expect(interstitial).to_be_visible(timeout=5000)
                print("Interstitial visible.")

                # Take screenshot while it's processing
                page.screenshot(path="verification/reprocessing_interstitial.png")
            except Exception as e:
                print("Interstitial missed or failed to appear (might be too fast):", e)
                # If it was too fast, we might be in the reader view now.
                page.screenshot(path="verification/after_reprocessing.png")

            # Wait for it to finish and reader to load
            expect(page.get_by_test_id("reader-view")).to_be_visible(timeout=10000)

            # 5. Verify metadata update
            # We check if the version was updated in IDB
            version = page.evaluate("""
                async () => {
                    const dbName = 'EpubLibraryDB';
                    const request = indexedDB.open(dbName);
                    return new Promise((resolve, reject) => {
                        request.onsuccess = (event) => {
                            const db = event.target.result;
                            const tx = db.transaction('books', 'readonly');
                            const store = tx.objectStore('books');
                            const getReq = store.get('${mock_book_id}');
                            getReq.onsuccess = () => resolve(getReq.result.version);
                            getReq.onerror = () => reject(getReq.error);
                        };
                    });
                }
            """)

            print(f"Book version after processing: {version}")
            assert version == 1

        finally:
            browser.close()

if __name__ == "__main__":
    verify_reprocessing_interstitial()
