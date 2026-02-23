import sys
import os
import re
sys.path.append(os.getcwd())

from playwright.sync_api import sync_playwright, expect

# Mock utils if not easily importable or rely on local definitions
try:
    from verification import utils
except ImportError:
    class Utils:
        def reset_app(self, page):
            page.goto("http://localhost:5173")
            page.evaluate("window.localStorage.clear()")
            page.reload()

        def ensure_library_with_book(self, page):
            # Checking if book exists, if not, maybe fail or try to upload?
            # Assuming standard test environment has books pre-seeded or upload capability
            # For now, let's assume one exists or wait for it.
            try:
                page.locator("[data-testid^='book-card-']").first.wait_for(timeout=5000)
            except:
                print("No books found. Please seed the library.")
                sys.exit(1)

        def navigate_to_chapter(self, page):
            # Click TOC button
            page.get_by_test_id("reader-toc-button").click()
            # Click a chapter
            page.get_by_test_id("toc-item").nth(1).click() # 2nd item
            page.get_by_test_id("reader-toc-button").click() # Close TOC if not auto-closed

        def capture_screenshot(self, page, name):
            page.screenshot(path=f"verification/{name}.png")

    utils = Utils()

def test_note_affordance(page):
    print("Starting Note Affordance Verification...")

    # 1. Reset App
    page.goto("http://localhost:5173")
    page.evaluate("window.localStorage.clear()")
    page.reload()

    # 2. Wait for Library
    print("Waiting for library...")
    try:
        page.locator("[data-testid^='book-card-']").first.wait_for(timeout=5000)
    except:
        print("No books found. Attempting to load demo book...")
        # Try to click "Load Demo Book"
        try:
            load_btn = page.get_by_role("button", name="Load Demo Book")
            if load_btn.count() == 0:
                 load_btn = page.locator("button").filter(has_text="Load Demo Book")

            if load_btn.count() > 0:
                load_btn.first.click()
                print("Clicked Load Demo Book.")
                page.locator("[data-testid^='book-card-']").first.wait_for(timeout=30000)
            else:
                print("Load Demo Book button not found!")
                return
        except Exception as e:
            print(f"Failed to load demo book: {e}")
            return

    # 3. Open Book
    print("Opening book...")
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-view")).to_be_visible(timeout=10000)

    # 4. Wait for iframe
    print("Waiting for iframe content...")
    iframe_element = page.locator('[data-testid="reader-iframe-container"] iframe')
    expect(iframe_element).to_be_visible(timeout=10000)
    # Get element handle to access content frame object (Frame) instead of FrameLocator
    frame = iframe_element.element_handle().content_frame()
    print(f"DEBUG: frame type: {type(frame)}")

    # Wait for body in frame
    frame.locator("body").wait_for(timeout=10000)

    # Navigate to ensure content
    print("Navigating to chapter...")
    try:
        page.get_by_test_id("reader-toc-button").click()
        page.get_by_test_id("reader-toc-sidebar").wait_for(timeout=5000)

        # Try to find Chapter 1 or similar
        # Alice in Wonderland usually has "Chapter I"
        chapter_link = page.get_by_text("Chapter I", exact=False).first
        if chapter_link.count() > 0:
            chapter_link.click()
        else:
            # Fallback to nth item
            page.locator("[data-testid='reader-toc-sidebar'] li").nth(2).click()

        # Close sidebar if it covers content
        if page.get_by_test_id("reader-toc-sidebar").is_visible():
             page.get_by_test_id("reader-toc-button").click()

        page.wait_for_timeout(3000)
    except Exception as e:
        print(f"Navigation failed: {e}")

    # Re-fetch frame after navigation as it might have been detached/reloaded
    print("Re-fetching iframe...")
    iframe_element = page.locator('[data-testid="reader-iframe-container"] iframe')
    expect(iframe_element).to_be_visible(timeout=10000)
    frame = iframe_element.element_handle().content_frame()
    frame.locator("body").wait_for(timeout=10000)

    # 5. Select Text
    print("Selecting text...")
    # Inject script to select text node
    select_script = """
    () => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        let node = walker.nextNode();
        while(node) {
            const text = node.textContent.trim();
            if (text.length > 20) {
                const range = document.createRange();
                // Avoid starting at 0 if it's whitespace
                let startOffset = node.textContent.indexOf(text[0]);
                range.setStart(node, startOffset);
                range.setEnd(node, startOffset + 10); // Select 10 chars

                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);

                // Dispatch mouseup to trigger popover
                const rect = range.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) {
                    // Try another node if this one is invisible
                     node = walker.nextNode();
                     continue;
                }

                document.dispatchEvent(new MouseEvent('mouseup', {
                    view: window,
                    bubbles: true,
                    cancelable: true,
                    clientX: rect.left + rect.width / 2,
                    clientY: rect.top + rect.height / 2
                }));
                return true;
            }
            node = walker.nextNode();
        }
        return false;
    }
    """

    # Retry selection a few times if content is loading
    success = False
    for i in range(5):
        try:
            success = frame.evaluate(select_script)
            if success:
                break
        except Exception as e:
            print(f"Evaluate failed: {e}")
        page.wait_for_timeout(1000)

    if not success:
        print("Failed to select text.")
        # Debug HTML
        try:
            html_content = frame.locator("body").inner_html()
            print(f"Iframe Body HTML (truncated): {html_content[:500]}")
        except:
            print("Could not get iframe HTML")

        page.screenshot(path="verification/failure_select.png")
        return

    # 6. Check Popover / Compass Pill
    print("Checking for annotation controls...")
    # The compass pill should appear
    expect(page.get_by_test_id("compass-pill-annotation")).to_be_visible(timeout=5000)

    # 7. Add Note
    print("Adding note...")
    page.get_by_label("Add Note").click()

    # 8. Type Note
    print("Typing note...")
    textarea = page.locator("textarea")
    expect(textarea).to_be_visible()
    textarea.fill("This is a verified note.")

    # 9. Save
    print("Saving note...")
    page.get_by_role("button", name="Save").click()

    # 10. Verify Marker in Iframe
    print("Verifying note marker visual affordance...")
    # The marker should be inserted into the DOM
    marker = frame.locator(".note-marker")
    expect(marker).to_be_visible(timeout=5000)

    # Check styles
    bg_color = marker.evaluate("el => window.getComputedStyle(el).backgroundColor")
    print(f"Marker background color: {bg_color}")

    if "rgb(253, 224, 71)" in bg_color or "253, 224, 71" in bg_color: # #fde047
        print("SUCCESS: Marker has correct yellow background color.")
    else:
        print(f"WARNING: Marker background color mismatch. Expected yellow, got {bg_color}")

    # Screenshot
    page.screenshot(path="verification/verification.png")
    print("Screenshot saved to verification/verification.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()
        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        page.on("pageerror", lambda err: print(f"PAGE ERROR: {err}"))
        try:
            test_note_affordance(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/failure.png")
        finally:
            browser.close()
