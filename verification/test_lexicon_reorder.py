import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_lexicon_reorder(page: Page):
    """
    Verifies that lexicon rules can be reordered in the UI.
    """
    utils.reset_app(page)

    # Open Global Settings
    page.get_by_test_id("header-settings-button").click()

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
    items = page.locator("[data-testid='lexicon-rules-list'] > div")
    expect(items).to_have_count(2)

    expect(items.nth(0)).to_contain_text("Apple")
    expect(items.nth(1)).to_contain_text("Banana")

    # Move Apple Down (Index 0)
    btn = page.get_by_test_id("lexicon-move-down-0")
    expect(btn).to_be_visible()
    btn.click()

    # Verify new order (UI update)
    # 1. Banana
    # 2. Apple
    expect(items.nth(0)).to_contain_text("Banana")
    expect(items.nth(1)).to_contain_text("Apple")

    # Wait for persistence (IndexedDB async write)
    page.wait_for_timeout(1000)

    # Close Dialog
    page.get_by_test_id("lexicon-close-btn").click()

    # Close Settings Modal (press Escape to ensure everything closes)
    page.keyboard.press("Escape")

    # Wait for settings to close
    page.wait_for_timeout(500)

    # Reload page to verify persistence
    page.reload()

    # Check again
    page.get_by_test_id("header-settings-button").click()
    page.get_by_role("button", name="Dictionary").click()
    page.get_by_role("button", name="Manage Rules").click()

    items = page.locator("[data-testid='lexicon-rules-list'] > div")
    expect(items).to_have_count(2)
    expect(items.nth(0)).to_contain_text("Banana")
    expect(items.nth(1)).to_contain_text("Apple")
