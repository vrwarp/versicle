
import os
import shutil
from playwright.sync_api import sync_playwright, expect

def verify_reprocess_button():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # 1. Open App
        page.goto("http://localhost:5173")
        page.wait_for_timeout(2000)

        # 2. Enable Debug Mode
        page.evaluate("""
            const store = JSON.parse(localStorage.getItem('genai-storage') || '{}');
            store.state = { ...store.state, isDebugModeEnabled: true };
            localStorage.setItem('genai-storage', JSON.stringify(store));
        """)

        # Reload to apply local storage
        page.reload()
        page.wait_for_timeout(2000)

        # 3. Check for Debug Panel presence
        debug_panel = page.get_by_text("Debug Panel")
        if debug_panel.count() > 0:
            print("Debug Panel found.")
            reprocess_btn = page.get_by_role("button", name="Reprocess Book")

            if reprocess_btn.is_visible():
                print("Reprocess Button is visible.")
                reprocess_btn.scroll_into_view_if_needed()
                page.screenshot(path="verification/reprocess_button.png")
            else:
                print("Reprocess Button NOT visible.")
                page.screenshot(path="verification/failed_verification.png")
                exit(1)
        else:
            print("Debug Panel not found immediately. Attempting to simulate active book.")

            # Inject dummy book
            page.evaluate("""
                (async () => {
                    function openDB() {
                         return new Promise((resolve, reject) => {
                             const request = indexedDB.open('EpubLibraryDB', 15);
                             request.onerror = reject;
                             request.onsuccess = (event) => resolve(event.target.result);
                         });
                    }

                    const db = await openDB();
                    const tx = db.transaction(['books', 'files', 'sections'], 'readwrite');

                    const bookId = 'dummy-book-123';
                    const book = {
                        id: bookId,
                        title: 'Dummy Book',
                        author: 'Test Author',
                        addedAt: Date.now(),
                        tablesProcessed: true, // IMPORTANT: Set to true to bypass ReprocessingInterstitial
                        fileHash: 'dummy',
                        totalChars: 100
                    };

                    tx.objectStore('books').put(book);
                    // Minimal EPUB blob (zip with just enough to not crash?)
                    // Actually ReaderView expects a file blob to open with epub.js
                    // If the blob is invalid, epub.js might error out and not render anything.
                    // But ContentAnalysisLegend might still render if it doesn't depend on successful load?
                    // ContentAnalysisLegend takes `rendition` prop.
                    // If epub.js fails, rendition might be null.
                    // But debug panel renders if isDebugModeEnabled is true, even if rendition is null?
                    // "if (!isDebugModeEnabled) return null;"
                    // It uses `rendition` in useEffect but handles null.

                    // So it should render.

                    tx.objectStore('files').put(new Blob(['dummy content']), bookId);

                    tx.objectStore('sections').put({
                         id: bookId + '-1',
                         bookId: bookId,
                         sectionId: 'chap1.html',
                         characterCount: 100,
                         playOrder: 0
                    });

                    return new Promise((resolve, reject) => {
                        tx.oncomplete = resolve;
                        tx.onerror = reject;
                    });
                })()
            """)

            page.wait_for_timeout(1000)
            page.goto("http://localhost:5173/read/dummy-book-123")
            page.wait_for_timeout(5000)

            # Retry finding debug panel
            debug_panel = page.get_by_text("Debug Panel")
            if debug_panel.count() > 0:
                 print("Debug Panel found after injecting book.")

                 reprocess_btn = page.get_by_role("button", name="Reprocess Book")
                 if reprocess_btn.is_visible():
                     print("Reprocess Button is visible.")
                     page.screenshot(path="verification/reprocess_button.png")
                 else:
                     print("Reprocess Button NOT visible. Screenshotting.")
                     page.screenshot(path="verification/failed_verification.png")
                     exit(1)
            else:
                 print("Debug Panel still not found. Screenshotting state.")
                 page.screenshot(path="verification/debug_panel_missing.png")
                 exit(1)

        browser.close()

if __name__ == "__main__":
    verify_reprocess_button()
