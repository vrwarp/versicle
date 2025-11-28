import asyncio
import re
from playwright.async_api import async_playwright, expect
import utils

async def run_test():
    async with async_playwright() as p:
        browser, context, page = await utils.setup(p)

        print("Starting Search Journey...")
        await utils.reset_app(page)
        await utils.ensure_library_with_book(page)

        # Open Book
        await page.get_by_text("Alice's Adventures in Wonderland").click()
        await expect(page.get_by_label("Back")).to_be_visible()

        # Open Search
        print("Opening Search...")
        await page.get_by_label("Search").click()
        search_input = page.locator("input[placeholder='Search in book...']")
        await expect(search_input).to_be_visible()

        results_list = page.locator("ul.space-y-4")
        # Don't check visibility of empty list

        # Retry search until results found (indexing might take time)
        for i in range(20):
            print(f"Search attempt {i+1}...")
            await search_input.fill("Alice")
            await search_input.press("Enter")

            try:
                # Wait briefly for results to appear
                await expect(results_list.locator("li").first).to_be_visible(timeout=2000)
                print("Results found.")
                break
            except AssertionError:
                print("No results yet, waiting...")
                await page.wait_for_timeout(1000)
        else:
            raise AssertionError("Search failed to return results after attempts.")

        await utils.capture_screenshot(page, "search_results")

        # Check text content of result
        first_result = results_list.locator("li").first
        text = await first_result.text_content()
        print(f"First result: {text}")

        # Click result to navigate
        await first_result.locator("button").click()

        # Close search using the Close button next to input
        close_btn = page.locator("input[placeholder='Search in book...']").locator("xpath=following-sibling::button")
        await close_btn.click()

        await utils.capture_screenshot(page, "search_after_nav")

        print("Search Journey Passed!")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run_test())
