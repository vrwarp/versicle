import asyncio
import re
from playwright.async_api import async_playwright, expect
import utils

async def run_test():
    async with async_playwright() as p:
        browser, context, page = await utils.setup(p)

        print("Starting Annotations Journey...")
        await utils.reset_app(page)
        await utils.ensure_library_with_book(page)

        # Open Book
        await page.get_by_text("Alice's Adventures in Wonderland").click()
        await expect(page.get_by_label("Back")).to_be_visible()

        # Wait for iframe content
        frame = page.frame_locator("iframe").first
        await frame.locator("body").wait_for(timeout=10000)

        # Get initial text to compare
        try:
            initial_text = await frame.locator("body").inner_text()
        except:
            initial_text = ""
        print(f"Initial Text: {initial_text[:50]}...")

        # 1. Create Highlight
        print("Creating Highlight...")

        # Navigate to a page with text (Next Page)
        # We might need to click multiple times to get past the cover and title pages
        # Check until we have substantial text
        for i in range(5):
             current_text = await frame.locator("body").inner_text()
             if len(current_text) > 200:
                 print("Found substantial text.")
                 break
             print(f"Clicking Next Page ({i+1})...")
             await page.get_by_label("Next Page").click()
             # Wait for text to change
             try:
                 await expect(frame.locator("body")).not_to_have_text(current_text, timeout=5000)
             except:
                 pass # Might have failed to change or timeout
             await page.wait_for_timeout(1000)

        # Re-locate frame to avoid detached frame errors
        frame = page.frame_locator("iframe").first
        await frame.locator("body").wait_for()

        # Inject script to select text reliably
        selection_success = await frame.locator("body").evaluate("""
            () => {
                try {
                    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
                    let node = walker.nextNode();
                    while(node) {
                        if (node.textContent.trim().length > 10) {
                            break;
                        }
                        node = walker.nextNode();
                    }

                    if (node) {
                        const range = document.createRange();
                        range.setStart(node, 0);
                        range.setEnd(node, 10);
                        const selection = window.getSelection();
                        selection.removeAllRanges();
                        selection.addRange(range);

                        // Dispatch mouseup to trigger epub.js selection event
                        // We will dispatch it from python side to be sure, or here.
                        // Epub.js often listens on the document.
                        return true;
                    }
                    return false;
                } catch (e) {
                    console.error("Selection script error:", e);
                    return false;
                }
            }
        """)

        if not selection_success:
            print("Could not select text for highlighting.")
            await utils.capture_screenshot(page, "annotations_failed_selection")
            return

        # Dispatch mouseup using Playwright on the body to ensure it reaches epub.js listeners
        await frame.locator("body").evaluate("""
            element => {
                const event = new MouseEvent('mouseup', {
                    bubbles: true,
                    cancelable: true,
                    clientX: 100,
                    clientY: 100,
                    view: window
                });
                element.dispatchEvent(event);
                // Also dispatch on document and window to be safe for epub.js listeners
                element.ownerDocument.dispatchEvent(event);
                element.ownerDocument.defaultView.dispatchEvent(event);
            }
        """)

        # Check for Popover (Highlight Color Buttons)
        # It might take a moment to appear
        try:
            await expect(page.get_by_title("Yellow")).to_be_visible(timeout=2000)
        except AssertionError:
             print("Popover did not appear normally. Trying manual emit...")
             # Try manual emit via window.__rendition
             await page.evaluate("""
                if (window.__rendition) {
                    const cfi = window.__rendition.currentLocation().start.cfi;
                    window.__rendition.emit('selected', cfi);
                }
             """)
             await page.wait_for_timeout(1000)
             try:
                await expect(page.get_by_title("Yellow")).to_be_visible(timeout=2000)
                print("Popover appeared after manual emit!")
             except AssertionError:
                print("Popover still not visible after manual emit.")
                await utils.capture_screenshot(page, "annotations_failed_popover")
                raise

        await utils.capture_screenshot(page, "annotations_1_popover")

        # Click Yellow
        await page.get_by_title("Yellow").click()
        await expect(page.get_by_title("Yellow")).not_to_be_visible()

        # Verify in Sidebar
        print("Verifying Highlight in Sidebar...")
        await page.get_by_label("Annotations").click()
        await expect(page.get_by_role("heading", name="Annotations")).to_be_visible()
        # Wait for list item
        await expect(page.locator("ul li").first).to_be_visible()
        await utils.capture_screenshot(page, "annotations_2_sidebar_highlight")

        # Close sidebar
        await page.get_by_label("Annotations").click()

        # 2. Create Note
        print("Creating Note...")
        # Re-locate frame
        frame = page.frame_locator("iframe").first
        await frame.locator("body").wait_for()

        # Select another text segment (offset)
        # We need to find a DIFFERENT node or different range
        await frame.locator("body").evaluate("""
            () => {
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
                let node = walker.nextNode();
                while(node) {
                     if (node.textContent.trim().length > 30) {
                         break;
                     }
                     node = walker.nextNode();
                }

                if (node) {
                    const range = document.createRange();
                    range.setStart(node, 15);
                    range.setEnd(node, 25);
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
            }
        """)

        # Dispatch mouseup again for Note
        await frame.locator("body").evaluate("""
            element => {
                const event = new MouseEvent('mouseup', {
                    bubbles: true,
                    cancelable: true,
                    view: window
                });
                element.dispatchEvent(event);
                element.ownerDocument.dispatchEvent(event);
                element.ownerDocument.defaultView.dispatchEvent(event);
            }
        """)

        try:
            await expect(page.get_by_title("Add Note")).to_be_visible(timeout=2000)
        except AssertionError:
             print("Note Popover did not appear normally. Trying manual emit...")
             await page.evaluate("""
                if (window.__rendition) {
                    const cfi = window.__rendition.currentLocation().start.cfi;
                    window.__rendition.emit('selected', cfi);
                }
             """)
             await expect(page.get_by_title("Add Note")).to_be_visible(timeout=2000)

        await page.get_by_title("Add Note").click()

        # Fill Note
        await page.get_by_placeholder("Enter note...").fill("My automated note")
        await page.get_by_label("Save Note").click()

        # Verify Note in Sidebar
        print("Verifying Note in Sidebar...")
        await page.get_by_label("Annotations").click()
        await expect(page.get_by_text("My automated note")).to_be_visible()
        await utils.capture_screenshot(page, "annotations_3_sidebar_note")

        print("Annotations Journey Passed!")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run_test())
