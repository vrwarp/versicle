import asyncio
from playwright.async_api import async_playwright, expect
import os

async def test_annotations():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        page.on("console", lambda msg: print(f"PAGE LOG: {msg.text}"))
        os.makedirs("verification/screenshots", exist_ok=True)

        print("1. Go to library")
        await page.goto("http://localhost:5173/")

        print("2. Upload book")
        file_input = page.locator("input[type='file']")
        await file_input.set_input_files("src/test/fixtures/alice.epub")
        await expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible(timeout=10000)

        print("3. Open book")
        await page.get_by_text("Alice's Adventures in Wonderland").click()
        await page.wait_for_url("**/read/*")

        await expect(page.get_by_label("Back")).to_be_visible()
        await page.wait_for_timeout(5000)

        frame = page.frame_locator("iframe").first
        await frame.locator("body").wait_for(timeout=10000)

        print("4. Create Highlight")

        # Navigate to next page to ensure we have text (Cover might be image only)
        # Clicking "Next Page" button
        await page.get_by_label("Next Page").click()
        await page.wait_for_timeout(2000) # Wait for render

        # Try finding text again
        selection_success = await frame.locator("body").evaluate("""
            () => {
                try {
                    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
                    let node = walker.nextNode();
                    // Find a node with enough text
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

                        console.log("Simulating selection on: " + node.textContent.substring(0, 10));

                        document.dispatchEvent(new MouseEvent('mouseup', {
                            view: window,
                            bubbles: true,
                            cancelable: true,
                            clientX: 100,
                            clientY: 100
                        }));
                        return true;
                    }
                    console.log("Body innerHTML length: " + document.body.innerHTML.length);
                    console.log("No suitable text node found even after next page.");
                    return false;
                } catch (e) {
                    console.error("Selection script error: " + e.message);
                    return false;
                }
            }
        """)

        if not selection_success:
            print("Failed to select text in iframe")
            await page.screenshot(path="verification/screenshots/annotations_failed_selection.png")
            raise Exception("Failed to select text in iframe")

        # Check for popover
        try:
            await expect(page.get_by_title("Yellow")).to_be_visible(timeout=5000)
        except AssertionError:
            print("Popover not visible.")
            await page.screenshot(path="verification/screenshots/annotations_3_popover_fail.png")
            raise

        await page.screenshot(path="verification/screenshots/annotations_3_popover.png")

        # Add highlight
        await page.get_by_title("Yellow").click()
        await expect(page.get_by_title("Yellow")).not_to_be_visible()

        # Check Annotations Sidebar
        await page.get_by_label("Annotations").click()
        await expect(page.get_by_role("heading", name="Annotations")).to_be_visible()

        # Verify annotation present
        await expect(page.locator("ul li").first).to_be_visible()
        await page.screenshot(path="verification/screenshots/annotations_4_sidebar_highlight.png")

        # Close sidebar
        await page.get_by_label("Annotations").click()

        print("5. Create Note")
        # Reuse the logic but offset
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
                    document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
                }
            }
        """)

        await expect(page.get_by_title("Add Note")).to_be_visible()
        await page.get_by_title("Add Note").click()

        await page.screenshot(path="verification/screenshots/annotations_5_note_input.png")

        # Input note and save
        await page.get_by_placeholder("Enter note...").fill("My test note")
        # Save button is the sticky note icon in the input group (green)
        await page.get_by_label("Save Note").click()

        # Open Sidebar again
        await page.get_by_label("Annotations").click()

        # Check if note appears in sidebar
        await expect(page.get_by_text("My test note")).to_be_visible()
        await page.screenshot(path="verification/screenshots/annotations_6_sidebar_note.png")

        print("Annotations verification passed.")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(test_annotations())
