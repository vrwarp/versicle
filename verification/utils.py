import os
from playwright.sync_api import Page, Frame, expect

def navigate_to_chapter(page: Page, chapter_id: str = "toc-item-6"):
    """
    Navigates to a specific chapter via the Table of Contents.

    Args:
        page: The Playwright Page object.
        chapter_id: The test ID of the chapter to select (default: toc-item-6 for Chapter 5).
    """
    print(f"Navigating to chapter: {chapter_id}...")
    page.get_by_test_id("reader-toc-button").click()
    page.get_by_test_id(chapter_id).click()

    # Wait for TOC to close
    expect(page.get_by_test_id("reader-toc-sidebar")).not_to_be_visible()

    # Ensure TOC overlay is gone and focus is returned
    page.locator("body").click(position={"x": 100, "y": 100})

    # Wait for content to render (check for compass pill)
    expect(page.get_by_test_id("compass-pill-active")).to_be_visible()
    page.wait_for_timeout(1000)

def reset_app(page: Page):
    """
    Resets the application state by navigating to the root URL and clearing storage.
    Waits for the app to load.

    Args:
        page: The Playwright Page object.
    """
    print("Resetting App...")
    # Navigate to blank page to release any DB locks
    page.goto("about:blank")

    # Go to app to clear storage (needs same origin)
    page.goto("http://localhost:5173", timeout=10000)

    # Explicitly clear IDB, LocalStorage, and Service Workers to ensure a clean slate
    page.evaluate("""
        async () => {
            // Clear IndexedDB
            const dbs = await window.indexedDB.databases();
            for (const db of dbs) {
                await new Promise((resolve, reject) => {
                    const req = window.indexedDB.deleteDatabase(db.name);
                    req.onsuccess = resolve;
                    req.onerror = reject;
                    req.onblocked = resolve;
                });
            }
            // Clear LocalStorage
            localStorage.clear();

            // Unregister Service Workers
            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                for(let registration of registrations) {
                    await registration.unregister();
                }
            }
        }
    """)

    # Inject Mock Flag again if it was lost (reset clears window state usually, but evaluate clears storage)
    page.add_init_script("window.__VERSICLE_MOCK_SYNC__ = true;")

    # Reload to apply cleared storage and fresh state
    page.reload()

    # Wait for app to be ready
    try:
        # Wait for potential migration overlay to clear first
        try:
            page.wait_for_selector("text=Updating Library", state="detached", timeout=10000)
        except:
            pass # Might not have appeared

        # Wait for either book card (if persistence failed to clear?) or empty library state
        # Also allow for "Critical Error" to fail faster if SW issue persists
        page.wait_for_selector("[data-testid^='book-card-'], button:has-text('Load Demo Book'), div:has-text('Your library is empty')", timeout=20000)
        print("App Reset Complete.")
    except Exception as e:
        print(f"Error: App load state check timed out. {e}")
        # Capture screenshot for debugging
        capture_screenshot(page, "reset_app_timeout")
        raise e # Re-raise to fail the test

def ensure_library_with_book(page: Page):
    """
    Ensures that the library has the demo book loaded.
    If not present, clicks the "Load Demo Book" button.
    Waits for the book card to appear.

    Args:
        page: The Playwright Page object.
    """
    print("Ensuring library has book...")
    # Check if book already exists (by text)
    if page.locator("[data-testid^='book-card-']").filter(has_text="Alice's Adventures in Wonderland").count() > 0:
        print("Book found.")
        return

    # If book not found, try to load
    print("Book not found, attempting to load demo book...")
    try:
        load_btn = page.get_by_role("button", name="Load Demo Book")
        if load_btn.count() == 0:
             # Maybe we are in empty state but button text is different or finding it differently
             load_btn = page.locator("button").filter(has_text="Load Demo Book")

        if load_btn.count() > 0 and load_btn.is_visible():
            load_btn.click()
            # Wait for book to appear
            page.wait_for_selector("[data-testid^='book-card-']", timeout=20000)
            print("Demo book loaded.")
        else:
            print("Error: 'Load Demo Book' button not found.")
            capture_screenshot(page, "missing_load_button")
            # If neither book nor button is found, check if we are in reader?
            if page.get_by_test_id("reader-view").count() > 0:
                 print("Warning: Stuck in Reader View. Attempting to exit...")
                 page.get_by_test_id("reader-back-button").click()
                 page.wait_for_selector("[data-testid^='book-card-']", timeout=10000)
                 return

            raise Exception("Cannot load demo book: Button not found")

    except Exception as e:
        print(f"Error ensuring library with book: {e}")
        capture_screenshot(page, "ensure_library_fail")
        raise e

def capture_screenshot(page: Page, name: str, hide_tts_status: bool = False):
    """
    Captures a screenshot of the current page state.
    Saves it to 'verification/screenshots/'.
    Appends '_mobile' or '_desktop' based on viewport width.

    Args:
        page: The Playwright Page object.
        name: The filename (without extension) for the screenshot.
        hide_tts_status: If True, hides the TTS debug overlay before capturing.
    """
    os.makedirs('verification/screenshots', exist_ok=True)

    if hide_tts_status:
        # Hide the element and wait for the style to be applied
        page.evaluate("""
            const el = document.getElementById('tts-debug');
            if (el) {
                el.style.visibility = 'hidden';
            }
        """)
        try:
            page.locator("#tts-debug").wait_for(state="hidden", timeout=1000)
        except:
            pass

    viewport = page.viewport_size
    width = viewport['width'] if viewport else 1280
    suffix = "mobile" if width < 600 else "desktop"
    path = f"verification/screenshots/{name}_{suffix}.png"
    page.screenshot(path=path, timeout=10000)
    print(f"Screenshot saved: {path}")

    if hide_tts_status:
        page.evaluate("const el = document.getElementById('tts-debug'); if (el) el.style.visibility = 'visible';")

def get_reader_frame(page: Page) -> Frame | None:
    """
    Retrieves the iframe containing the epub.js reader.

    Args:
        page: The Playwright Page object.

    Returns:
        The Playwright Frame object for the reader, or None if not found.
    """
    for frame in page.frames:
         # Simplified check for epubjs iframe (blob url or name)
         if frame != page.main_frame and ("epubjs" in (frame.name or "") or "blob:" in (frame.url or "")):
             return frame
    return None
