import re
import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_journey_scrolled_mode(page: Page):
    print("Starting Scrolled Mode Journey...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # 1. Open Book
    print("Opening Book first time...")
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))
    page.wait_for_timeout(2000)

    # 2. Set View Mode to Scrolled
    print("Setting View Mode to Scrolled...")
    # Open Visual Settings Popover
    visual_btn = page.get_by_test_id("reader-visual-settings-button")
    visual_btn.click()
    expect(page.get_by_text("Layout")).to_be_visible()

    # Click Scrolled Tab
    scrolled_tab = page.get_by_role("tab", name="Scrolled")
    scrolled_tab.click()
    page.wait_for_timeout(1000)

    # Close settings
    page.mouse.click(10, 10)
    page.wait_for_timeout(500)

    # Verify we are in scrolled mode (spacer should be there now because we switched)
    frame_loc = page.locator('[data-testid="reader-iframe-container"] iframe').content_frame
    frame_loc.locator("body").wait_for(timeout=2000)

    # Just to be sure it's there initially
    expect(frame_loc.locator('#reader-bottom-spacer')).to_have_count(1)

    # 3. Navigate back to Library
    print("Navigating back to Library...")
    # Assuming there is a back button or we can navigate via URL.
    # The UI usually has a back arrow or "Library" link in the top bar.
    # Checking existing tests or UI... usually top-left back button.
    # Based on `utils.navigate_to_library` if it exists? No.
    # Let's try finding a back button.
    back_btn = page.locator('button[aria-label="Go back"]')
    if back_btn.count() > 0:
        back_btn.click()
    else:
        # Fallback: Click the top-left area where back usually is, or navigate URL
        # Let's try navigating to root
        page.goto("http://localhost:5173/")

    expect(page).to_have_url(re.compile(r".*/$")) # Library is root
    page.wait_for_timeout(1000)

    # 4. Re-open the book
    print("Re-opening Book...")
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))
    page.wait_for_timeout(3000) # Wait for load

    # 5. Check for spacer immediately
    print("Checking for spacer immediately after load...")
    frame_loc = page.locator('[data-testid="reader-iframe-container"] iframe').content_frame
    frame_loc.locator("body").wait_for(timeout=2000)

    # This expectation should fail if the bug exists
    count = frame_loc.locator('#reader-bottom-spacer').count()
    print(f"Spacer count: {count}")

    # We want to assert it is present.
    expect(frame_loc.locator('#reader-bottom-spacer')).to_have_count(1)

    utils.capture_screenshot(page, "spacer_verification")
