import re
import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_lexicon_trace(page: Page):
    print("Starting Lexicon Trace Test...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    print("Opening book...")
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))

    # Wait for book to load
    page.wait_for_timeout(2000)

    # Open Audio Deck -> Settings -> Lexicon
    print("Opening Pronunciation Lexicon...")
    page.get_by_test_id("reader-audio-button").click()
    # Click Settings tab inside the TTS Panel
    page.get_by_test_id("tts-settings-tab-btn").click(force=True)
    page.get_by_text("Manage Pronunciation Rules").click()

    # 1. Add Rule 1: Hello -> Hi
    print("Adding Rule 1...")
    page.get_by_test_id("lexicon-add-rule-btn").click()
    page.get_by_test_id("lexicon-input-original").fill("Hello")
    page.get_by_test_id("lexicon-input-replacement").fill("Hi")
    page.get_by_test_id("lexicon-save-rule-btn").click()

    # 2. Add Rule 2: World -> Earth
    print("Adding Rule 2...")
    page.get_by_test_id("lexicon-add-rule-btn").click()
    page.get_by_test_id("lexicon-input-original").fill("World")
    page.get_by_test_id("lexicon-input-replacement").fill("Earth")
    page.get_by_test_id("lexicon-save-rule-btn").click()

    # 3. Test Trace
    print("Testing Trace...")
    test_input = page.get_by_test_id("lexicon-test-input")
    test_input.fill("Hello World")

    # Click "All Rules"
    page.get_by_test_id("lexicon-test-all-btn").click()

    # Verify Final Output
    print("Verifying Output...")
    expect(page.get_by_text("Processed:")).to_be_visible()
    # "Hi Earth" appears in both "Processed" and the Trace.
    # Processed output appears first in the DOM.
    expect(page.get_by_text("Hi Earth").first).to_be_visible()

    # Verify Trace Steps
    print("Verifying Trace Steps...")
    expect(page.get_by_text("Transformation Steps")).to_be_visible()

    # Check for trace items
    # We expect to see "Hello -> Hi" and "World -> Earth"
    expect(page.get_by_text("Hello → Hi")).to_be_visible()
    expect(page.get_by_text("World → Earth")).to_be_visible()

    # Check intermediate states in trace
    # "Hi World" (result of first rule)
    expect(page.get_by_text("Hi World")).to_be_visible()

    # 4. Test Bible Rule Trace
    print("Testing Bible Rule Trace...")
    test_input.fill("Gen. 1")
    page.get_by_test_id("lexicon-test-all-btn").click()

    # Verify Bible Rule Badge
    expect(page.get_by_text("Bible", exact=True)).to_be_visible()
    # Verify Rule Display
    # The regex for Genesis is complex, so we just check the replacement
    expect(page.get_by_text("→ Genesis")).to_be_visible()

    # Scroll to the bottom to ensure the trace is fully visible in the screenshot
    page.get_by_test_id("lexicon-list-container").evaluate("el => el.scrollTop = el.scrollHeight")

    utils.capture_screenshot(page, "lexicon_trace_verified")
    print("Lexicon Trace Test Passed!")
