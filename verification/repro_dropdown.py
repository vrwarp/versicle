
import asyncio
from playwright.async_api import async_playwright, expect

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        try:
            await page.goto("http://localhost:5173", timeout=10000)
        except Exception as e:
            print(f"Failed to load page: {e}")
            await browser.close()
            return

        # Check for empty library and load demo book
        await page.wait_for_selector("text=Your library is empty", timeout=5000)
        print("Library is empty. Loading demo book...")

        load_demo_btn = page.get_by_text("Load Demo Book")
        await load_demo_btn.click()

        # Wait for book card to appear
        # The demo book loading involves fetch and processing, might take a few seconds
        try:
            await page.wait_for_selector("[data-testid^='book-card-']", timeout=20000)
            print("Book loaded.")
        except:
            print("Timed out waiting for book to load.")
            await page.screenshot(path="verification/timeout.png")
            await browser.close()
            return

        # Now verify the dropdown
        book_cards = page.locator("[data-testid^='book-card-']")
        count = await book_cards.count()
        print(f"Found {count} books.")

        first_card = book_cards.first
        menu_trigger = first_card.locator("[data-testid='book-menu-trigger']")

        await expect(menu_trigger).to_be_visible()

        # Test clicking
        await menu_trigger.click()

        # Check if menu opens
        await expect(page.locator("[role='menu']")).to_be_visible()
        await page.screenshot(path="verification/menu_open.png")
        print("Menu opened successfully on click.")

        # Close menu
        await page.keyboard.press("Escape")
        await expect(page.locator("[role='menu']")).not_to_be_visible()

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
