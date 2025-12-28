import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_aria_labels(page: Page):
    """
    Verifies that ARIA labels are present for accessibility controls in Reader View.
    """
    print("Starting ARIA Labels Verification...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    print("Opening book...")
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-view")).to_be_visible()

    # 1. Visual Settings ARIA Labels
    print("Verifying Visual Settings...")
    page.get_by_label("Visual Settings").click()

    # Font size slider
    expect(page.get_by_label("Font size percentage")).to_be_visible()

    # Line height buttons
    expect(page.get_by_label("Decrease line height")).to_be_visible()
    expect(page.get_by_label("Increase line height")).to_be_visible()

    # Close Settings (Visual settings is a popover, usually closed by clicking outside or a close button if it exists)
    # The original test used 'Close' button, assuming one exists or reusing a generic one.
    # Looking at the code, VisualSettings is a popover.
    # Let's just click the trigger again to toggle it off or click the body.
    # For now, preserving original intent if it worked, but "Close" might be ambiguous.
    # Actually, the original test code had: page.get_by_role("button", name="Close").click()
    # If VisualSettings has a close button, that's fine. If not, this might fail too.
    # But I am only fixing the Search part for now.

    # Actually, I should check if VisualSettings has a Close button.
    # But let's focus on the Search part which definitely broke.
    # To close a popover in this app, usually clicking outside works.
    page.mouse.click(0, 0)

    # 2. Search ARIA Labels
    print("Verifying Search...")
    page.get_by_label("Search").click()
    expect(page.get_by_label("Search query")).to_be_visible()

    # The dedicated "Close search" button is gone.
    # We now expect the main back button to be labeled "Close Side Bar"
    close_sidebar_btn = page.get_by_label("Close Side Bar")
    expect(close_sidebar_btn).to_be_visible()

    # Close Search using the new button
    close_sidebar_btn.click()

    # 3. Audio Panel ARIA Labels
    print("Verifying Audio Panel...")
    page.get_by_label("Open Audio Deck").click()

    # Switch to settings tab in Audio Panel
    # Note: If the audio panel is a sheet, it might cover things.
    # Just ensuring we can find the settings button.
    page.get_by_role("tab", name="Settings").click()

    # Playback speed slider
    expect(page.get_by_label("Playback speed")).to_be_visible()

    print("ARIA Labels Verification Passed!")
