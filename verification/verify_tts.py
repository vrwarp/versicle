
import asyncio
from playwright.async_api import async_playwright, expect

async def verify_tts_settings():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()
        page.set_default_timeout(10000)

        try:
            # Go to home page
            await page.goto("http://localhost:5173")

            # Upload book if needed (assuming clean state or checking if book exists)
            # Check if Alice is already there
            alice_book = page.get_by_text("Alice's Adventures in Wonderland")
            if await alice_book.count() == 0:
                print("Uploading book...")
                file_input = page.locator('input[type="file"]')
                await file_input.set_input_files('src/test/fixtures/alice.epub')
                await page.wait_for_timeout(2000) # Wait for processing

            # Open book
            print("Opening book...")
            await page.get_by_text("Alice's Adventures in Wonderland").first.click()

            # Open TTS Panel
            print("Opening TTS Panel...")
            tts_trigger = page.locator('button[aria-label="Text to Speech"]')
            await tts_trigger.wait_for(state="visible")
            await tts_trigger.click()

            # Wait for TTS Panel
            tts_panel = page.locator("div.absolute.z-30", has_text="Text to Speech")
            await tts_panel.wait_for(state="visible")

            # Find Settings button inside TTS Panel
            # It's the button containing the Settings icon (lucide-settings)
            # Or just the second button in the flex container
            print("Clicking Voice Settings...")

            # We can use the fact that it is next to the Play button which has text or specific styling
            # But let's look for the svg with class 'lucide-settings' inside the tts_panel
            # settings_icon = tts_panel.locator("svg.lucide-settings")
            # settings_btn = settings_icon.locator("..") # Parent button

            # Actually, there are two settings icons on screen probably (one in header, one in TTS panel).
            # So scope to tts_panel.
            settings_btn = tts_panel.locator("button").nth(2)
            # Wait, nth(0) is Close (X), nth(1) is Play, nth(2) is Settings?
            # Header: <h3>Text to Speech</h3> <button><X/></button> (Index 0)
            # Flex row: <button>Play</button> (Index 1) <button>Settings</button> (Index 2)

            await settings_btn.click()

            # Verify "Provider" label is visible
            print("Verifying Voice Settings...")
            provider_label = page.get_by_text("Provider")
            await provider_label.wait_for(state="visible")

            # Select "Google Cloud TTS"
            await page.select_option('select', 'google')

            # Verify "Google API Key" input is visible
            await expect(page.get_by_text("Google API Key")).to_be_visible()

            # Take screenshot
            print("Taking screenshot...")
            await page.screenshot(path="verification/tts_settings.png")
            print("Done.")

        except Exception as e:
            print(f"Error: {e}")
            await page.screenshot(path="verification/error_retry.png")
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(verify_tts_settings())
