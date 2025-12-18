import pytest
from playwright.sync_api import Page, expect
import utils

def test_lexicon_reorder(page: Page):
    """
    Verifies that lexicon rules can be reordered in the UI.
    """
    utils.reset_app(page)

    # Open Global Settings
    page.get_by_test_id("reader-settings-button").click()

    # Go to Dictionary tab
    page.get_by_role("button", name="Dictionary").click()

    # Open Manage Rules
    page.get_by_role("button", name="Manage Rules").click()

    # Add first rule: Apple -> A
    page.get_by_test_id("lexicon-add-rule-btn").click()
    page.get_by_test_id("lexicon-input-original").fill("Apple")
    page.get_by_test_id("lexicon-input-replacement").fill("A")
    page.get_by_test_id("lexicon-save-rule-btn").click()

    # Add second rule: Banana -> B
    page.get_by_test_id("lexicon-add-rule-btn").click()
    page.get_by_test_id("lexicon-input-original").fill("Banana")
    page.get_by_test_id("lexicon-input-replacement").fill("B")
    page.get_by_test_id("lexicon-save-rule-btn").click()

    # Verify initial order (Insertion order)
    # 1. Apple
    # 2. Banana
    items = page.locator("[data-testid='lexicon-list-container'] > div > div")
    expect(items).to_have_count(2)

    expect(items.nth(0)).to_contain_text("Apple")
    expect(items.nth(1)).to_contain_text("Banana")

    # Move Apple Down (Index 0)
    page.get_by_test_id("lexicon-move-down-0").click()

    # Verify new order
    # 1. Banana
    # 2. Apple
    expect(items.nth(0)).to_contain_text("Banana")
    expect(items.nth(1)).to_contain_text("Apple")

    # Close Dialog and Settings
    page.get_by_role("button", name="Close").click()
    page.keyboard.press("Escape") # Close settings modal if needed or click outside

    # Reload page to verify persistence
    page.reload()

    # Check again
    page.get_by_test_id("reader-settings-button").click()
    page.get_by_role("button", name="Dictionary").click()
    page.get_by_role("button", name="Manage Rules").click()

    items = page.locator("[data-testid='lexicon-list-container'] > div > div")
    expect(items).to_have_count(2)
    expect(items.nth(0)).to_contain_text("Banana")
    expect(items.nth(1)).to_contain_text("Apple")
