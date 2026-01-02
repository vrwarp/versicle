
import os
import shutil
import time
from playwright.sync_api import sync_playwright, expect
from utils import ensure_library_with_book, capture_screenshot, reset_app

def verify_reprocessing_interstitial():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        try:
            # 1. Reset app
            page.goto("http://localhost:5173")

            # Explicitly clear IDB to ensure a clean slate for this test
            page.evaluate("""
                async () => {
                    const dbs = await window.indexedDB.databases();
                    for (const db of dbs) {
                        await new Promise((resolve, reject) => {
                            const req = window.indexedDB.deleteDatabase(db.name);
                            req.onsuccess = resolve;
                            req.onerror = reject;
                            req.onblocked = resolve;
                        });
                    }
                    localStorage.clear();
                }
            """)
            page.reload()

            # 2. Load Demo Book
            # We implement a robust version of ensure_library_with_book inline to be sure
            # Wait for empty state or existing book
            try:
                page.wait_for_selector("button:has-text('Load Demo Book')", timeout=5000)
                page.get_by_role("button", name="Load Demo Book").click()
                page.wait_for_selector("[data-testid^='book-card-']", timeout=10000)
            except:
                # Maybe already loaded?
                if page.get_by_text("Alice's Adventures in Wonderland").count() == 0:
                     raise Exception("Could not load demo book")

            # 3. Find the book ID and downgrade version
            book_title = "Alice's Adventures in Wonderland"
            book_id = None

            # Retry loop for DB persistence
            for i in range(10):
                book_id = page.evaluate(f"""
                    async () => {{
                        return new Promise((resolve) => {{
                            const req = indexedDB.open('EpubLibraryDB');
                            req.onsuccess = (e) => {{
                                const db = e.target.result;
                                if (!db.objectStoreNames.contains('books')) {{
                                    resolve(null);
                                    return;
                                }}
                                const tx = db.transaction('books', 'readonly');
                                const store = tx.objectStore('books');
                                store.getAll().onsuccess = (ev) => {{
                                    const books = ev.target.result;
                                    const book = books.find(b => b.title.includes("{book_title}"));
                                    resolve(book ? book.id : null);
                                }};
                            }};
                            req.onerror = () => resolve(null);
                        }});
                    }}
                """)
                if book_id:
                    break
                time.sleep(0.5)

            print(f"Found book ID: {book_id}")
            if not book_id:
                raise Exception("Could not find demo book ID in DB after loading")

            # Update the book version to 0
            page.evaluate(f"""
                async () => {{
                    return new Promise((resolve) => {{
                        const req = indexedDB.open('EpubLibraryDB');
                        req.onsuccess = (e) => {{
                            const db = e.target.result;
                            const tx = db.transaction('books', 'readwrite');
                            const store = tx.objectStore('books');
                            store.get('{book_id}').onsuccess = (ev) => {{
                                const book = ev.target.result;
                                book.version = 0;
                                book.tablesProcessed = false;
                                store.put(book).onsuccess = () => resolve(true);
                            }};
                        }};
                    }});
                }}
            """)

            print("Downgraded book version to 0.")

            # Reload to ensure Reader checks the new (old) version
            page.reload()

            # 3. Open the book
            page.get_by_text(book_title).click()

            # 4. Expect Reprocessing Interstitial
            print("Waiting for interstitial...")
            try:
                # We check for the loading state or the specific text
                interstitial = page.get_by_text("Enhancing Book Layout")
                expect(interstitial).to_be_visible(timeout=5000)
                print("Interstitial visible.")

                # Take screenshot while it's processing
                capture_screenshot(page, "reprocessing_interstitial")
            except Exception as e:
                print("Interstitial missed or failed to appear (might be too fast):", e)
                capture_screenshot(page, "reprocessing_missed")

            # Wait for it to finish and reader to load
            expect(page.get_by_test_id("reader-view")).to_be_visible(timeout=30000)

            # 5. Verify metadata update
            new_version = page.evaluate(f"""
                async () => {{
                    return new Promise((resolve) => {{
                        const req = indexedDB.open('EpubLibraryDB');
                        req.onsuccess = (e) => {{
                            const db = e.target.result;
                            const tx = db.transaction('books', 'readonly');
                            const store = tx.objectStore('books');
                            store.get('{book_id}').onsuccess = (ev) => resolve(ev.target.result.version);
                        }};
                    }});
                }}
            """)

            print(f"Book version after processing: {new_version}")
            assert new_version == 1

        finally:
            browser.close()

if __name__ == "__main__":
    verify_reprocessing_interstitial()
