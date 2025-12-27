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
    Resets the application state by navigating to the root URL.
    Waits for the app to load.

    Args:
        page: The Playwright Page object.
    """
    page.goto("http://localhost:5173", timeout=5000)
    # Clear local storage to ensure clean state
    page.evaluate("localStorage.clear()")
    # Reload to apply cleared storage
    page.reload()
    # Wait for app to be ready
    try:
        page.wait_for_selector("[data-testid^='book-card-'], button:has-text('Load Demo Book'), div:has-text('Your library is empty')", timeout=10000)
    except:
        print("Warning: App load state check timed out.")

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
