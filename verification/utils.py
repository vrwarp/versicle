import os
import base64
import json
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

def inject_book(page: Page, epub_path: str):
    """
    Injects an EPUB book directly into the IndexedDB before the app loads.
    This bypasses the UI ingestion process.

    Args:
        page: The Playwright Page object.
        epub_path: Path to the EPUB file to inject.
    """
    print(f"Injecting book from: {epub_path}")

    # Read file
    with open(epub_path, "rb") as f:
        content = f.read()

    # Base64 encode
    b64_content = base64.b64encode(content).decode('utf-8')
    file_size = len(content)

    # Define metadata for Alice
    # Note: We use a fixed ID for consistency.
    book_id = "alice-uuid"
    metadata = {
        "id": book_id,
        "title": "Alice's Adventures in Wonderland",
        "author": "Lewis Carroll",
        "description": "Alice's Adventures in Wonderland (commonly shortened to Alice in Wonderland) is an 1865 fantasy novel written by English mathematician Charles Lutwidge Dodgson under the pseudonym Lewis Carroll. It tells of a young girl named Alice falling through a rabbit hole into a fantasy world populated by peculiar, anthropomorphic creatures. The tale plays with logic, giving the story lasting popularity with adults as well as with children. It is considered to be one of the best examples of the literary nonsense genre. Its narrative course and structure, characters and imagery have been enormously influential in both popular culture and literature, especially in the fantasy genre.",
        "addedAt": 1700000000000,
        "fileSize": file_size,
        "filename": os.path.basename(epub_path),
        "coverUrl": "",
        "progress": 0,
        "totalChars": 0,
    }

    metadata_json = json.dumps(metadata)

    script = f"""
    const bookId = "{book_id}";
    const flagKey = "injected_" + bookId;

    // Check if we already injected in this session to avoid wiping restored data on reload
    if (!sessionStorage.getItem(flagKey)) {{
        sessionStorage.setItem(flagKey, 'true');
        console.log('Running DB injection script for ' + bookId);
        const dbName = 'EpubLibraryDB';

        // Delete existing DB to ensure clean state and avoid version conflicts during init
        const reqDelete = indexedDB.deleteDatabase(dbName);

        reqDelete.onsuccess = function() {{
            // Open with version 1 to trigger upgrade for schema creation
            const reqOpen = indexedDB.open(dbName, 1);

            reqOpen.onupgradeneeded = function(e) {{
                const db = e.target.result;
                // Create 'books' store
                if (!db.objectStoreNames.contains('books')) {{
                    const booksStore = db.createObjectStore('books', {{ keyPath: 'id' }});
                    booksStore.createIndex('by_title', 'title', {{ unique: false }});
                    booksStore.createIndex('by_author', 'author', {{ unique: false }});
                    booksStore.createIndex('by_addedAt', 'addedAt', {{ unique: false }});
                }}
                // Create 'files' store
                if (!db.objectStoreNames.contains('files')) {{
                    db.createObjectStore('files');
                }}
            }};

            reqOpen.onsuccess = function(e) {{
                const db = e.target.result;
                const tx = db.transaction(['books', 'files'], 'readwrite');
                const booksStore = tx.objectStore('books');
                const filesStore = tx.objectStore('files');

                const metadata = {metadata_json};
                const b64 = "{b64_content}";

                // Convert base64 to Blob
                const byteCharacters = atob(b64);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {{
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }}
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], {{ type: 'application/epub+zip' }});

                booksStore.put(metadata);
                filesStore.put(blob, metadata.id);

                tx.oncomplete = function() {{
                    console.log('Book injected successfully');
                    db.close();
                }};
            }};
        }};
    }} else {{
        console.log('Skipping DB injection (already injected in this session)');
    }}
    """

    page.add_init_script(script)

def reset_app(page: Page, preload_epub: str | None = None):
    """
    Resets the application state by navigating to the root URL.
    Waits for the app to load.

    Args:
        page: The Playwright Page object.
        preload_epub: Optional path to an EPUB file to preload into IndexedDB.
    """
    if preload_epub:
        # Clear session storage to ensure the injection script runs (wiping the DB)
        # This handles cases where reset_app is called multiple times in the same session.
        try:
            page.evaluate("sessionStorage.clear()")
        except:
            # Ignore errors (e.g. if page is not loaded yet or cross-origin issues)
            pass
        inject_book(page, preload_epub)

    page.goto("http://localhost:5173", timeout=10000)

    # Check if empty library is shown or verify app loaded
    # page.wait_for_selector...

def ensure_library_with_book(page: Page):
    """
    Ensures that the library has the demo book loaded.
    If not present, clicks the "Load Demo Book" button.
    Waits for the book card to appear.

    Args:
        page: The Playwright Page object.
    """
    # Wait for initial render (either book or load button)
    try:
        page.wait_for_selector("[data-testid^='book-card-'], button:has-text('Load Demo Book')", timeout=10000)
    except:
        print("Warning: Neither book card nor load button found within 10s")
        pass # Proceed to check

    if page.get_by_text("Alice's Adventures in Wonderland").count() > 0:
        return

    # If book not found, try to load
    load_btn = page.get_by_role("button", name="Load Demo Book")
    if load_btn.count() > 0 and load_btn.is_visible():
        load_btn.click()
        # Wait for book to appear
        try:
            page.wait_for_selector("[data-testid^='book-card-']", timeout=2000)
        except:
            # Retry once if button is still there (flaky click?)
            if load_btn.is_visible():
                load_btn.click()
                page.wait_for_selector("[data-testid^='book-card-']", timeout=2000)

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
                // Force a reflow/repaint check if possible, or just rely on the synchronous evaluation
            }
        """)
        # Explicitly wait for the element to be hidden from the playwright perspective
        # This ensures the rendering engine has caught up before we take the screenshot
        try:
            page.locator("#tts-debug").wait_for(state="hidden", timeout=1000)
        except:
            # Proceed even if timeout (maybe element doesn't exist)
            pass

    viewport = page.viewport_size
    width = viewport['width'] if viewport else 1280
    suffix = "mobile" if width < 600 else "desktop"
    page.screenshot(path=f"verification/screenshots/{name}_{suffix}.png", timeout=10000)

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
