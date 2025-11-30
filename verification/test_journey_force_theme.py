
import pytest
from playwright.sync_api import Page, expect
from verification.utils import reset_app, capture_screenshot

def test_journey_force_theme(page: Page):
    """
    Test the Force Theme Style toggle user journey.
    1. Load the demo book (Alice in Wonderland).
    2. Navigate to Chapter I (which has formatted text).
    3. Capture screenshot of default rendering.
    4. Enable 'Force Theme Style'.
    5. Capture screenshot of forced rendering.
    6. Disable 'Force Theme Style'.
    7. Capture screenshot to verify revert.
    """

    # 1. Reset and load app
    reset_app(page)

    # Load demo book
    page.get_by_text("Load Demo Book").click()

    # Wait for book to appear in library and click it
    # We assume the demo book is "Alice's Adventures in Wonderland"
    page.get_by_text("Alice's Adventures in Wonderland").click()

    page.wait_for_selector("[data-testid='reader-iframe-container']", timeout=10000)

    # 2. Navigate to Chapter I
    # Open TOC
    page.get_by_test_id("reader-toc-button").click()

    # Wait for TOC to be visible
    page.wait_for_selector("[data-testid='reader-toc-sidebar']")

    # Click Chapter I
    # Alice TOC usually has "Down the Rabbit-Hole" as Chapter I
    page.get_by_text("I. Down the Rabbit-Hole").click()

    # Wait for navigation (content update)
    # The iframe content changes. It's hard to hook into that exactly without internals.
    # We'll wait a bit.
    page.wait_for_timeout(2000)

    # 3. Screenshot Default
    print("Capturing default screenshot")
    capture_screenshot(page, "force_theme_01_default")

    # 4. Enable Force Theme
    # Open Settings
    page.get_by_test_id("reader-settings-button").click()

    # Wait for settings
    expect(page.get_by_test_id("settings-panel")).to_be_visible()

    # Toggle Force Font
    # The toggle is visually an input[type=checkbox] inside a label.
    # The input is usually hidden (sr-only) or overlapped by the pseudo-element toggle UI.
    # We should click the label or force the click on the input.
    # Given the test failure "intercepts pointer events", we force click or check via label.
    page.get_by_test_id("settings-force-font").click(force=True)

    # Close Settings to see the book better
    page.get_by_test_id("settings-close-button").click()

    # Wait for styles to apply
    page.wait_for_timeout(1000)

    # 5. Screenshot Forced
    print("Capturing forced screenshot")
    capture_screenshot(page, "force_theme_02_forced")

    # 6. Disable Force Theme
    page.get_by_test_id("reader-settings-button").click()
    page.get_by_test_id("settings-force-font").click(force=True)
    page.get_by_test_id("settings-close-button").click()

    # Wait for revert
    page.wait_for_timeout(1000)

    # 7. Screenshot Reverted
    print("Capturing reverted screenshot")
    capture_screenshot(page, "force_theme_03_reverted")

    # Optional: Basic assertion that screenshots 1 and 2 are likely different is hard programmatically here,
    # but the screenshots will serve as visual verification.
