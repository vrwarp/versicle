import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_tts_fallback(page: Page):
    console_logs = []
    # Capture all arguments for better visibility of error objects
    page.on("console", lambda msg: console_logs.append(f"{msg.type}: {msg.text}"))

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
    page.select_option("data-testid=tts-provider-select", "google")

    # Close Settings (back)
    page.click("text=Back")

    # Click Play
    print("Clicking play...")
    # Use data-testid for Play button if available, or current selector
    # ReaderView.tsx: data-testid="tts-play-pause-button"
    page.click("data-testid=tts-play-pause-button")

    # Handle Cost Warning Dialog if it appears (It's a React Dialog, not native)
    # The dialog title is "Cost Warning"
    # We might need to wait briefly to see if it appears
    try:
        if page.is_visible("text=Cost Warning", timeout=1000):
            print("Cost Warning Dialog appeared. Clicking Proceed...")
            page.click("text=Proceed")
    except:
        # Dialog didn't appear, proceed
        pass

    print("Waiting for logs...")
    # Increase wait to allow for retries and fallback
    page.wait_for_timeout(3000)

    # Check for console logs indicating error and fallback
    # Expected logs: "Play error Error: Google Cloud API Key is missing" and "Falling back to WebSpeechProvider..."
    # The actual log format might vary slightly in browser console vs playwright capture

    logs_text = "\n".join(console_logs)
    print("Console logs captured:")
    print(logs_text)

    # The error might be logged as "error: Play error [object Error]" or similar
    # We check for substring
    assert "Google Cloud API Key is missing" in logs_text
    assert "Falling back to WebSpeechProvider" in logs_text

    print("Fallback logs verified!")
