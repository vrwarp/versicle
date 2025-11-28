import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_tts_fallback(page: Page):
    print("Loading app...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # 3. Open the book
    print("Opening book...")
    page.click("text=Alice's Adventures in Wonderland")

    # Wait for reader container
    page.wait_for_selector(".w-full.h-full.overflow-hidden", timeout=2000)

    # Open TOC and go to Chapter I (to ensure we have text)
    print("Navigating to Chapter I...")
    page.click("button[aria-label='Table of Contents']")
    page.wait_for_selector("text=Chapter I", timeout=2000)
    page.click("text=Chapter I")

    # Wait a bit for text loading/queue population
    page.wait_for_timeout(2000)

    print("Triggering TTS error scenario...")

    # Open TTS controls
    page.click("button[aria-label='Text to Speech']")
    page.wait_for_selector("text=Voice", timeout=2000)

    # Open Settings
    # Try aria-label first
    try:
        page.click("button[aria-label='Voice Settings']", timeout=1000)
    except:
        # Fallback to nth(2) if label missing
         tts_panel = page.locator("h3", has_text="Text to Speech").locator("xpath=../..")
         tts_panel.locator("button").nth(2).click()

    # Select Google Cloud
    page.select_option("select", "google")

    # Close Settings (back)
    page.click("text=Back")

    # Click Play
    print("Clicking play...")
    page.click(".flex-1.bg-primary")

    print("Waiting for toast...")
    # Allow some time for toast to appear
    # Cap at 2000ms as requested
    page.wait_for_selector("text=Cloud voice failed", timeout=2000)
    print("Toast appeared!")
    utils.capture_screenshot(page, "tts_fallback_toast_retry")
