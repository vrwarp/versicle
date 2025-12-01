import os
from playwright.sync_api import Page, Frame

def reset_app(page: Page):
    """
    Resets the application state by navigating to the root URL.
    Waits for the app to load.

    Args:
        page: The Playwright Page object.
    """
    page.goto("http://localhost:5173", timeout=5000)
    # Check if empty library is shown or verify app loaded
    # page.wait_for_selector...

def ensure_library_with_book(page: Page):
    """
    Ensures that the library has the demo book loaded.
    If not present, clicks the "Load Demo Book" button.

    Args:
        page: The Playwright Page object.
    """
    if page.get_by_text("Alice's Adventures in Wonderland").count() == 0:
        page.get_by_text("Load Demo Book").click()
        page.wait_for_timeout(1000)

def capture_screenshot(page: Page, name: str):
    """
    Captures a screenshot of the current page state.
    Saves it to 'verification/screenshots/'.
    Appends '_mobile' or '_desktop' based on viewport width.

    Args:
        page: The Playwright Page object.
        name: The filename (without extension) for the screenshot.
    """
    os.makedirs('verification/screenshots', exist_ok=True)
    viewport = page.viewport_size
    width = viewport['width'] if viewport else 1280
    suffix = "mobile" if width < 600 else "desktop"
    page.screenshot(path=f"verification/screenshots/{name}_{suffix}.png")

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
