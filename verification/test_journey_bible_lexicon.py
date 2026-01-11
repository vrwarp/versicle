import pytest
import re
from playwright.sync_api import Page, expect
from verification import utils

def test_journey_bible_lexicon(page: Page):
    print("Starting Bible Lexicon Journey Verification...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # 1. Open Global Settings from Library View
    print("Opening Global Settings...")
    page.click("button[data-testid='header-settings-button']")
    expect(page.get_by_role("dialog")).to_be_visible()

    # 2. Switch to Dictionary Tab
    print("Switching to Dictionary Tab...")
    page.get_by_role("button", name="Dictionary").click()

    # 3. Verify Bible Lexicon Global Toggle
    print("Verifying Global Toggle...")
    bible_toggle = page.get_by_label("Enable Bible Abbreviations & Lexicon")
    expect(bible_toggle).to_be_visible()

    # Ensure it's checked by default (based on implementation)
    expect(bible_toggle).to_be_checked()

    utils.capture_screenshot(page, "bible_lexicon_global_settings")

    # Close settings
    page.keyboard.press("Escape")
    expect(page.get_by_role("dialog")).not_to_be_visible()

    # 4. Open Book to check Per-Book Overrides
    print("Opening Book...")
    page.get_by_text("Alice's Adventures in Wonderland").first.click()
    expect(page).to_have_url(re.compile(r".*/read/.*"), timeout=10000)

    # 5. Open Lexicon Manager (Dictionary) from Reader Settings
    print("Opening Reader Settings > Dictionary...")
    page.click("button[data-testid='reader-settings-button']")
    expect(page.get_by_role("dialog")).to_be_visible()
    page.get_by_role("button", name="Dictionary").click()

    # 6. Verify Per-Book Override Controls
    print("Verifying Per-Book Controls...")
    # Open "Manage Rules" dialog
    page.get_by_role("button", name="Manage Rules").click()

    # Wait for Lexicon Manager Dialog (nested or replaced content)
    # The LexiconManager is a separate dialog triggered by the button
    # Using specific role locator to avoid strict mode violation
    expect(page.get_by_role("heading", name="Pronunciation Lexicon")).to_be_visible()

    # Switch to "This Book" scope
    page.get_by_text("This Book").click()

    # Verify Bible Preference Buttons (Default / On / Off)
    print("Verifying Preference Buttons...")
    expect(page.get_by_role("button", name="Default")).to_be_visible()
    expect(page.get_by_role("button", name="On", exact=True)).to_be_visible()
    expect(page.get_by_role("button", name="Off", exact=True)).to_be_visible()

    # 7. Test Bible Lexicon OFF logic
    print("Testing Bible Lexicon OFF replacement...")
    # Turn OFF
    page.get_by_role("button", name="Off", exact=True).click()

    # Input test text
    page.get_by_test_id("lexicon-test-input").fill("Matt. 5:15")

    # Click All Rules
    page.get_by_test_id("lexicon-test-all-btn").click()

    # Expect NO replacement (Matt. -> Matt.) because Lexicon is OFF
    # The output text should be "Matt. 5:15"
    expect(page.locator("text=Processed: Matt. 5:15")).to_be_visible()

    # 8. Test Bible Lexicon ON logic
    print("Testing Bible Lexicon ON replacement...")
    # Turn ON
    page.get_by_role("button", name="On", exact=True).click()

    # Click All Rules (input remains from previous step)
    page.get_by_test_id("lexicon-test-all-btn").click()

    # Expect replacement (Matt. -> Matthew) because Lexicon is ON
    expect(page.locator("text=Processed: Matthew 5:15")).to_be_visible()

    utils.capture_screenshot(page, "bible_lexicon_book_override")
    print("Verification Complete.")
