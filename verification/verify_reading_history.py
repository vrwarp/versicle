import asyncio
from playwright.async_api import async_playwright

async def verify_reading_history():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        # Listen for console logs
        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))

        print("Navigating to home page...")
        await page.goto("http://localhost:5173")

        # Ensure library has book
        print("Checking library state...")
        try:
            await page.wait_for_selector("[data-testid^='book-card-'], button:has-text('Load Demo Book')", timeout=5000)
        except Exception as e:
            print("Timeout waiting for library/button")

        # Check if book exists
        book_count = await page.get_by_text("Alice's Adventures in Wonderland").count()

        if book_count == 0:
            print("Book not found. Clicking 'Load Demo Book'...")
            load_btn = page.get_by_role("button", name="Load Demo Book")
            if await load_btn.count() > 0 and await load_btn.is_visible():
                await load_btn.click()
                print("Clicked Load Demo Book. Waiting for book card...")
                await page.wait_for_selector("[data-testid^='book-card-']", timeout=10000)
            else:
                print("Load Demo Book button not found/visible!")
                await browser.close()
                return

        # Open the first book (Alice in Wonderland)
        print("Opening book...")
        await page.click("[data-testid^='book-card-']")

        # Wait for reader to load
        print("Waiting for reader...")
        await page.wait_for_selector("[data-testid='reader-view']", timeout=10000)

        # Wait a bit for initial render
        await asyncio.sleep(5)

        print("Navigating to next page...")
        await page.keyboard.press("ArrowRight")
        await asyncio.sleep(2)

        print("Navigating to next page again...")
        await page.keyboard.press("ArrowRight")
        await asyncio.sleep(2)

        # Open History Panel
        print("Opening History Panel...")
        history_btn = page.locator("[data-testid='reader-history-button']")
        if await history_btn.count() > 0:
            await history_btn.click()
            print("Clicked History Button")

            # Wait for sidebar
            sidebar = page.locator("[data-testid='reader-history-sidebar']")
            await sidebar.wait_for()

            # Check for entries
            entries = sidebar.locator("button:has-text('Resume from end')")
            count = await entries.count()
            print(f"Found {count} history entries in panel.")

            if count > 0:
                print("SUCCESS: History panel shows entries.")
            else:
                print("FAILURE: History panel is empty.")

        else:
            print("FAILURE: History button not found!")

        # Check visual indications (screenshots might be needed)
        await page.screenshot(path="verification/verification.png")
        print("Screenshot saved to verification/verification.png")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify_reading_history())
