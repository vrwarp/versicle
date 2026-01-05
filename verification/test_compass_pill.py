import re
from playwright.sync_api import Page, expect
from verification import utils

def test_compass_pill(page: Page):
    print("Starting Compass Pill Journey...")

    # Clear local storage to ensure TTS queue is empty
    page.goto("/")
    page.evaluate("localStorage.clear()")

    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # 1. Open Book
    print("Opening book...")
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))

    # 2. Simulate reading (navigate to a chapter)
    print("Navigating to chapter to ensure progress...")
    # Open TOC
    page.get_by_test_id("reader-toc-button").click()
    # Click item 2 (Chapter 2 usually, definitely > 0 progress)
    page.get_by_test_id("toc-item-2").click()
    # Wait for TOC to close (it auto closes)
    expect(page.get_by_test_id("reader-toc-sidebar")).not_to_be_visible()

    # Dwell time to ensure history recording logic (which requires > 2s duration)
    # works if we move again, but here we just want to establish a position.
    print("Reading (dwelling) for a few seconds...")
    page.wait_for_timeout(4000)

    # Move page slightly to trigger onLocationChange again if needed and ensure updates
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(2000)

    # 3. Go back to Library
    print("Going back to library...")
    page.get_by_test_id("reader-back-button").click()
    expect(page).to_have_url(re.compile(r".*/$"))

    # Wait for library to load and update
    page.wait_for_timeout(2000)

    # 4. Check for Compass Pill
    print("Checking for Compass Pill...")
    # The existing pill component is reused, which uses this test ID for summary view
    pill = page.get_by_test_id("compass-pill-summary")
    expect(pill).to_be_visible()

    expect(pill).to_contain_text("Continue Reading")
    expect(pill).to_contain_text("% complete")

    utils.capture_screenshot(page, "compass_pill_visible")

    # 5. Click Compass Pill
    print("Clicking Compass Pill...")
    pill.click()

    # 6. Verify returned to reader
    expect(page).to_have_url(re.compile(r".*/read/.*"))
    utils.capture_screenshot(page, "compass_pill_clicked")

    print("Compass Pill Journey Passed!")
