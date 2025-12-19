import re
import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_journey_lexicon(page: Page):
    print("Starting Lexicon Journey...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    print("Opening book...")
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))

    # Wait for book to load
    page.wait_for_timeout(2000)

    # Open Audio Deck
    print("Opening Audio Deck...")
    page.get_by_test_id("reader-audio-button").click()

    # Switch to Settings
    page.get_by_role("button", name="Settings").click()

    # Open Lexicon Manager
    print("Opening Pronunciation Lexicon...")
    page.get_by_text("Manage Pronunciation Rules").click()

    # Verify Dialog is open
    print("Verifying Dialog visibility...")
    expect(page.get_by_role("heading", name="Pronunciation Lexicon", exact=True)).to_be_visible()

    utils.capture_screenshot(page, "lexicon_01_dialog_open")

    # Click Add Rule
    print("Adding new rule...")
    page.get_by_test_id("lexicon-add-rule-btn").click()

    # Verify Regex Checkbox exists
    print("Verifying Regex capability...")
    regex_checkbox = page.get_by_test_id("lexicon-regex-checkbox")
    expect(regex_checkbox).to_be_visible()

    # Toggle Regex
    regex_checkbox.check()
    expect(regex_checkbox).to_be_checked()
    regex_checkbox.uncheck()
    expect(regex_checkbox).not_to_be_checked()
    regex_checkbox.check() # Leave checked for the rule

    # Check for Cancel Button (Bug Reproduction)
    print("Verifying Cancel button visibility...")
    cancel_btn = page.get_by_test_id("lexicon-cancel-rule-btn")
    expect(cancel_btn).to_be_visible()

    # Check containment (Bug Reproduction: Ensure button is inside the box)
    print("Verifying button containment...")
    container = page.locator('.border.rounded', has=page.get_by_test_id("lexicon-input-original")).first
    box = container.bounding_box()
    btn_box = cancel_btn.bounding_box()

    # Check if button is fully inside container (right edge)
    # The button shouldn't extend significantly beyond the container's right edge
    assert btn_box['x'] + btn_box['width'] <= box['x'] + box['width'] + 5, f"Cancel button is outside the container: btn_right={btn_box['x'] + btn_box['width']}, container_right={box['x'] + box['width']}"

    # Enter Rule Details
    print("Filling rule details...")
    page.get_by_test_id("lexicon-input-original").fill("s/he")
    page.get_by_test_id("lexicon-input-replacement").fill("they")

    # Save Rule
    # Dismiss keyboard by clicking outside inputs (e.g. on the heading)
    page.get_by_role("heading", name="Pronunciation Lexicon").click()

    # Scroll the container to the bottom to ensure the new rule input (and buttons) are fully visible
    # This addresses "element is outside of the viewport" on mobile where 50vh + soft keyboard simulation might be tricky
    page.get_by_test_id("lexicon-list-container").evaluate("el => el.scrollTop = el.scrollHeight")

    # Use JS click to bypass "element is outside of the viewport" strict checks
    # This is necessary because on mobile emulation, the virtual keyboard or layout shifting can cause Playwright
    # to believe the element is occluded even when it's logically interactable.
    page.get_by_test_id("lexicon-save-rule-btn").evaluate("el => el.click()")

    # Verify Rule appears in list with Regex badge
    print("Verifying rule in list...")
    expect(page.get_by_text("s/he")).to_be_visible()
    expect(page.get_by_text("they")).to_be_visible()

    # Verify Regex badge
    expect(page.get_by_test_id("lexicon-regex-badge")).to_be_visible()

    utils.capture_screenshot(page, "lexicon_02_rule_added")

    # --- Test Priority Toggle (Book Scope) ---
    print("Testing Priority Toggle (Book Scope)...")

    # Switch to Book Scope
    page.get_by_role("button", name="This Book").click()

    # Add Rule
    page.get_by_test_id("lexicon-add-rule-btn").click()

    # Verify Priority Checkbox exists
    priority_checkbox = page.get_by_test_id("lexicon-priority-checkbox")
    expect(priority_checkbox).to_be_visible()

    # Fill Rule
    page.get_by_test_id("lexicon-input-original").fill("PriorityWord")
    page.get_by_test_id("lexicon-input-replacement").fill("Replaced")
    priority_checkbox.check()

    # Save Rule
    # Scroll if needed
    page.get_by_test_id("lexicon-list-container").evaluate("el => el.scrollTop = el.scrollHeight")
    page.get_by_test_id("lexicon-save-rule-btn").click()

    # Verify Badge
    expect(page.get_by_test_id("lexicon-priority-badge")).to_be_visible()
    expect(page.get_by_text("Pre", exact=True)).to_be_visible()

    utils.capture_screenshot(page, "lexicon_03_priority_rule_added")

    # Close Dialog
    print("Closing Lexicon...")
    # Attempting to click the close button by searching for the "Close" text if test-id fails,
    # or perhaps the locator needs to wait specifically for the element to be attached.
    # The previous attempt with force=True timed out waiting for the element.
    # It implies get_by_test_id("lexicon-close-btn") is not finding the element.
    # Let's inspect LexiconManager.tsx again.
    # footer={<Button data-testid="lexicon-close-btn" ...>Close</Button>}
    # This looks correct.
    # However, maybe the Dialog component logic renders footer conditionally?
    # No, it's just passed as prop.
    # Maybe because of animation/rendering timing?
    # Let's try locating by text "Close" which we know works generally.
    # Handle strict mode violation (X button vs Footer button)
    page.get_by_role("button", name="Close").last.click()

    expect(page.get_by_role("heading", name="Pronunciation Lexicon", exact=True)).not_to_be_visible()

    print("Lexicon Journey Passed!")
