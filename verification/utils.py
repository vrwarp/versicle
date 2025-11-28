import os
import asyncio
from playwright.async_api import expect, Page, BrowserContext, Browser

SCREENSHOT_DIR = "verification/screenshots"

async def setup(p):
    """Launches browser and creates a new page."""
    browser = await p.chromium.launch(args=[
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process"
    ])
    context = await browser.new_context()
    page = await context.new_page()
    # Enable console logging for debugging
    page.on("console", lambda msg: print(f"PAGE LOG: {msg.text}"))
    page.on("pageerror", lambda err: print(f"PAGE ERROR: {err}"))
    return browser, context, page

async def capture_screenshot(page: Page, name: str):
    """Captures a screenshot with the given name."""
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)
    if not name.endswith(".png"):
        name += ".png"
    await page.screenshot(path=os.path.join(SCREENSHOT_DIR, name))

async def reset_app(page: Page):
    """Clears LocalStorage and IndexedDB to ensure a clean state."""
    await page.goto("http://localhost:5173")
    await page.evaluate("window.localStorage.clear()")
    # We must be careful with IndexedDB deletion. It can be blocked if there are open connections.
    # We will reload first to ensure no connections, then delete?
    # Or rely on the promise wrapper.
    await page.evaluate("""
        new Promise((resolve, reject) => {
            const req = indexedDB.deleteDatabase('EpubLibraryDB');
            req.onsuccess = () => resolve('Deleted');
            req.onerror = () => reject('Failed to delete');
            req.onblocked = () => resolve('Blocked but proceeding');
        })
    """)
    await page.reload()
    await expect(page).to_have_title("Versicle")

async def ensure_library_with_book(page: Page):
    """Ensures that the library has the test book uploaded."""
    # Check if book exists
    try:
        await expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible(timeout=2000)
        return
    except AssertionError:
        pass # Book not found, proceed to upload

    # Upload if not
    file_input = page.locator("input[type='file']")
    # Assuming the CWD is repo root
    await file_input.set_input_files("src/test/fixtures/alice.epub")
    await expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible(timeout=10000)
