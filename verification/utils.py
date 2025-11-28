import os
from playwright.sync_api import expect, Page

SCREENSHOT_DIR = "verification/screenshots"

def capture_screenshot(page: Page, name: str):
    """Captures a screenshot with the given name."""
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)
    if not name.endswith(".png"):
        name += ".png"
    page.screenshot(path=os.path.join(SCREENSHOT_DIR, name))

def reset_app(page: Page):
    """Clears LocalStorage and IndexedDB to ensure a clean state."""
    page.goto("http://localhost:5173")
    page.evaluate("window.localStorage.clear()")
    # We must be careful with IndexedDB deletion. It can be blocked if there are open connections.
    page.evaluate("""
        new Promise((resolve, reject) => {
            const req = indexedDB.deleteDatabase('EpubLibraryDB');
            req.onsuccess = () => resolve('Deleted');
            req.onerror = () => reject('Failed to delete');
            req.onblocked = () => resolve('Blocked but proceeding');
        })
    """)
    page.reload()
    expect(page).to_have_title("Versicle")

def ensure_library_with_book(page: Page):
    """Ensures that the library has the test book uploaded."""
    # Check if book exists
    try:
        expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible(timeout=2000)
        return
    except AssertionError:
        pass # Book not found, proceed to upload

    # Upload if not
    file_input = page.locator("input[type='file']")
    # Assuming the CWD is repo root
    file_input.set_input_files("src/test/fixtures/alice.epub")
    # Cap timeout at 2000ms
    expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible(timeout=2000)
