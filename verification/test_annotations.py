import asyncio
from playwright.async_api import async_playwright, expect

async def test_annotations():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # Navigate to app
        await page.goto("http://localhost:5173/")

        # Check if we need to upload
        if await page.get_by_text("Your library is empty").is_visible():
            async with page.expect_file_chooser() as fc_info:
                await page.locator('input[type="file"]').click()
            file_chooser = await fc_info.value
            await file_chooser.set_files("src/test/fixtures/alice.epub")
            await expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible()

        # Open book
        await page.get_by_text("Alice's Adventures in Wonderland").click()
        await page.wait_for_url("**/read/*")

        # Wait for iframe
        frame = page.frame_locator("iframe")
        await frame.locator("p").first.wait_for()

        # Select text - Inject JS to create a selection range
        await frame.locator("body").evaluate("""
            () => {
                const range = document.createRange();
                const node = document.querySelector('p').firstChild;
                if (node) {
                    range.setStart(node, 0);
                    range.setEnd(node, 10);
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);

                    // Dispatch mouseup to trigger epub.js selection handler
                    document.dispatchEvent(new MouseEvent('mouseup', {
                        view: window,
                        bubbles: true,
                        cancelable: true
                    }));
                }
            }
        """)

        # Check for popover
        await expect(page.get_by_title("Yellow")).to_be_visible()

        # Add highlight
        await page.get_by_title("Yellow").click()
        await expect(page.get_by_title("Yellow")).not_to_be_visible()

        # Check Annotations Sidebar
        await page.get_by_label("Annotations").click()

        # Expect the annotation text to be visible in the list ("Alice's Ad" approx)
        await expect(page.get_by_text("Alice", exact=False)).to_be_visible()

        # Test Note - Select another text range
        await frame.locator("body").evaluate("""
            () => {
                const range = document.createRange();
                const node = document.querySelector('p').firstChild;
                if (node) {
                    range.setStart(node, 15);
                    range.setEnd(node, 20);
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                    document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
                }
            }
        """)
        await expect(page.get_by_title("Add Note")).to_be_visible()
        await page.get_by_title("Add Note").click()

        # Input note and save
        await page.get_by_placeholder("Enter note...").fill("My test note")
        # Save button is the sticky note icon in the input group (green)
        await page.get_by_role("button").filter(has_text="Save").first.click()

        # Check if note appears in sidebar
        await expect(page.get_by_text("My test note")).to_be_visible()

        await browser.close()

if __name__ == "__main__":
    asyncio.run(test_annotations())
