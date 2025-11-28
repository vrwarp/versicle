
import asyncio
import os
from playwright.async_api import async_playwright, expect

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        try:
            # 1. Load the app
            print("Loading app...")
            await page.goto("http://localhost:5173")

            # 2. Upload book (Alice) if not present
            file_input = page.locator("input[type='file']")
            await file_input.wait_for()

            print("Uploading book...")
            await file_input.set_input_files("verification/alice.epub")

            # Wait for book card to appear
            await page.wait_for_selector("text=Alice's Adventures in Wonderland")

            # 3. Open the book
            print("Opening book...")
            await page.click("text=Alice's Adventures in Wonderland")

            # Wait for reader container
            await page.wait_for_selector(".w-full.h-full.overflow-hidden")

            # Open TOC and go to Chapter I (to ensure we have text)
            print("Navigating to Chapter I...")
            await page.click("button[aria-label='Table of Contents']")
            await page.wait_for_selector("text=Chapter I")
            await page.click("text=Chapter I")

            # Wait a bit for text loading/queue population
            await asyncio.sleep(3)

            print("Triggering TTS error scenario...")

            # Open TTS controls
            await page.click("button[aria-label='Text to Speech']")
            await page.wait_for_selector("text=Voice", timeout=5000)

            # Open Settings
            await page.click("button[aria-label='Voice Settings']")

            # Select Google Cloud
            await page.select_option("select", "google")

            # Close Settings (back)
            await page.click("text=Back")

            # Check if queue has items (Wait for "No text available" to disappear if it was there, or check for text)
            # The screenshot showed "No text available".
            # If we navigated correctly, it should show sentences.

            # Click Play
            print("Clicking play...")
            await page.click(".flex-1.bg-primary")

            print("Waiting for toast...")
            # Allow some time for toast to appear
            # GoogleTTSProvider might fail fast with "Missing API Key" or similar.
            await page.wait_for_selector("text=Cloud voice failed", timeout=8000)
            print("Toast appeared!")

        except Exception as e:
            print("Verification step failed or timed out:", e)
        finally:
            print("Taking screenshot...")
            await page.screenshot(path="verification/screenshots/tts_fallback_toast_retry.png")
            await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
