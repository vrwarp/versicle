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
    page.locator('[data-testid="book-card"]').click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))

    # Wait for book to load
    page.wait_for_timeout(2000)

    # Open Settings
    print("Opening Settings...")
    page.locator('[aria-label="Settings"]').click()

    # Verify Settings Panel is visible
    expect(page.get_by_test_id("settings-panel")).to_be_visible()

    # Open Lexicon Manager
    print("Opening Pronunciation Lexicon...")
    # The button text is "Pronunciation Lexicon"
    page.get_by_text("Pronunciation Lexicon").click()

    # Verify Dialog is open
    # Note: The Dialog component might not have role="dialog" explicitly set in its div,
    # so we check for the title "Pronunciation Lexicon" which acts as confirmation.
    # We use get_by_role("heading") because the button to open it also has this text.
    print("Verifying Dialog visibility...")
    expect(page.get_by_role("heading", name="Pronunciation Lexicon", exact=True)).to_be_visible()

    # Click Add Rule
    print("Adding new rule...")
    page.get_by_role("button", name="Add Rule").click()

    # Verify Regex Checkbox exists
    print("Verifying Regex capability...")
    regex_checkbox = page.get_by_label("Regex")
    expect(regex_checkbox).to_be_visible()

    # Toggle Regex
    regex_checkbox.check()
    expect(regex_checkbox).to_be_checked()
    regex_checkbox.uncheck()
    expect(regex_checkbox).not_to_be_checked()
    regex_checkbox.check() # Leave checked for the rule

    # Enter Rule Details
    print("Filling rule details...")
    # Assuming the inputs are found by placeholder or order
    # Based on LexiconManager.tsx: placeholder="Original" and "Replacement"
    page.get_by_placeholder("Original").fill("s/he")
    page.get_by_placeholder("Replacement").fill("they")

    # Save Rule
    # The button is a small save icon button. It's inside the flex container.
    # We can target it by the Save icon or its parent button classes.
    # Since we can't easily rely on icons in playwright without aria-labels or test-ids,
    # we'll look for the button inside the adding section.
    # But wait, looking at the code, it's just a <button><Save/></button>.
    # It has no text content "Save" directly visible as text node, likely inside SVG or empty.
    # The previous locator "button:has-text('Save')" might fail if 'Save' is not text.
    # The Lucide icon likely doesn't render text.

    # Let's target the button that contains the Save icon or is the 3rd child in that row.
    # Or better, let's rely on the fact that it is a button with green text/hover class.
    page.locator("button.text-green-600").click()

    # Verify Rule appears in list with Regex badge
    print("Verifying rule in list...")
    expect(page.get_by_text("s/he")).to_be_visible()
    expect(page.get_by_text("they")).to_be_visible()

    # The badge is "RE" in purple - text transform might make it "Re" in DOM
    # The code says <span ...>Re</span> and uppercased via CSS? No, wait:
    # {rule.isRegex && <span className="text-[10px] uppercase font-bold text-purple-600 border border-purple-200 bg-purple-50 px-1 rounded">Re</span>}
    # "uppercase" class makes it visually RE, but DOM text is "Re".
    # Playwright's get_by_text matches against visual text if exact is not specified?
    # But exact=True usually checks DOM text or normalized text.
    # Let's try "Re" or remove exact=True.
    expect(page.get_by_text("Re", exact=True)).to_be_visible()

    # Close Dialog
    print("Closing Lexicon...")
    # There are multiple close buttons (settings close, dialog 'x', dialog footer 'Close').
    # We want the dialog footer 'Close' button or the X.
    # The footer button is likely the one with text "Close".
    # The error message says:
    # 3) <button ...>Close</button> aka get_by_text("Close")
    # Let's target it specifically.
    page.locator("button:text-is('Close')").click()
    # The text "Pronunciation Lexicon" is also on the button in settings that opens it.
    # So checking not_to_be_visible for "Pronunciation Lexicon" might fail because the trigger button is still there.
    # We should check that the *Dialog* title or content is gone.
    # The heading "Pronunciation Lexicon" inside the dialog should be gone.
    expect(page.get_by_role("heading", name="Pronunciation Lexicon", exact=True)).not_to_be_visible()

    print("Lexicon Journey Passed!")
