
from playwright.sync_api import Page

def reset_app(page: Page):
    page.goto("http://localhost:5173", timeout=5000)
    # Check if empty library is shown or verify app loaded
    # page.wait_for_selector...

def ensure_library_with_book(page: Page):
    # Logic to add book if needed
    # For now assume Alice is there or can be added
    if page.get_by_text("Alice's Adventures in Wonderland").count() == 0:
        page.get_by_text("Load Demo Book").click()
        page.wait_for_timeout(1000)

def capture_screenshot(page: Page, name: str):
    page.screenshot(path=f"verification/screenshots/{name}.png")

def get_reader_frame(page: Page):
    for frame in page.frames:
         if frame != page.main_frame and ("epubjs" in (frame.name or "") or "blob:" in (frame.url or "")):
             return frame
    return None
