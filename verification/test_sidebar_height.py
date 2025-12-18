
import os
import time
from playwright.sync_api import sync_playwright, expect
from verification.utils import ensure_library_with_book, reset_app, capture_screenshot

def test_sidebar_height(page):
    page.on("console", lambda msg: print(f"Browser console: {msg.text}"))

    reset_app(page)
    ensure_library_with_book(page)

    # Open Reader
    page.locator('[data-testid^="book-card-"]').first.click()
    expect(page.get_by_test_id("reader-view")).to_be_visible()

    # Open TOC
    page.get_by_test_id("reader-toc-button").click()
    expect(page.get_by_test_id("reader-toc-sidebar")).to_be_visible()

    # Inspect children of Tabs Root
    page.evaluate("""() => {
        const sidebar = document.querySelector('[data-testid="reader-toc-sidebar"]');
        const tabsRoot = sidebar.firstElementChild;

        console.log("Tabs Root Children:");
        Array.from(tabsRoot.children).forEach((child, index) => {
            const style = window.getComputedStyle(child);
            console.log(`Child ${index}: Tag=${child.tagName}, Display=${style.display}, Height=${child.getBoundingClientRect().height}, FlexGrow=${style.flexGrow}`);
            if (child.getAttribute('role') === 'tabpanel') {
                 console.log(`  Role=tabpanel, State=${child.getAttribute('data-state')}, ID=${child.id}`);
            }
        });

        const content = document.querySelector('[data-state="active"][role="tabpanel"]');
        if (Math.abs(sidebar.getBoundingClientRect().bottom - content.getBoundingClientRect().bottom) > 5) {
            throw new Error(`Content does not extend to bottom.`);
        }
    }""")

    capture_screenshot(page, "sidebar_layout")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        try:
            test_sidebar_height(page)
        except Exception as e:
            print(f"Error: {e}")
            exit(1)
        finally:
            browser.close()
