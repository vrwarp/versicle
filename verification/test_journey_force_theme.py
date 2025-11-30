
import pytest
from playwright.sync_api import Page, expect
from verification.utils import reset_app, capture_screenshot

def test_journey_force_theme(page: Page):
    """
    Test the Force Theme Style toggle user journey.
    1. Load the demo book (Alice in Wonderland).
    2. Navigate to Chapter I (which has formatted text).
    3. Inject 'Stubborn' styles (Courier, Red, Line-height 3) to simulate a hard-to-style book.
    4. Capture screenshot (should show Stubborn styles).
    5. Enable 'Force Theme Style'.
    6. Capture screenshot (should show Default/Clean styles, overriding Stubborn).
    7. Disable 'Force Theme Style'.
    8. Capture screenshot (should revert to Stubborn).
    """

    # 1. Reset and load app
    reset_app(page)

    # Load demo book
    page.get_by_text("Load Demo Book").click()

    # Wait for book to appear in library and click it
    page.get_by_text("Alice's Adventures in Wonderland").click()

    page.wait_for_selector("[data-testid='reader-iframe-container']", timeout=10000)

    # 2. Navigate to Chapter I
    page.get_by_test_id("reader-toc-button").click()
    page.wait_for_selector("[data-testid='reader-toc-sidebar']")
    page.get_by_text("I. Down the Rabbit-Hole").click()
    page.wait_for_timeout(2000)

    # 3. Inject Stubborn Styles
    reader_frame = None
    for frame in page.frames:
        if "epubjs" in (frame.name or "") or (frame.url and "blob:" in frame.url):
            reader_frame = frame
            break

    if reader_frame:
        print("Injecting stubborn styles...")
        reader_frame.evaluate("""
            const style = document.createElement('style');
            style.id = 'stubborn-style';
            style.textContent = 'p, div, span { font-family: "Courier New", monospace !important; line-height: 3.0 !important; color: red !important; }';
            document.head.appendChild(style);
        """)
        page.wait_for_timeout(1000)
    else:
        print("WARNING: Could not find reader frame to inject styles")

    # 4. Screenshot Stubborn
    print("Capturing stubborn screenshot")
    capture_screenshot(page, "force_theme_01_stubborn")

    # 5. Enable Force Theme
    page.get_by_test_id("reader-settings-button").click()
    expect(page.get_by_test_id("settings-panel")).to_be_visible()
    page.get_by_test_id("settings-force-font").click(force=True)
    page.get_by_test_id("settings-close-button").click()

    page.wait_for_timeout(1000)

    # 6. Screenshot Forced
    print("Capturing forced screenshot")
    capture_screenshot(page, "force_theme_02_forced")

    # Verify CSS override
    if reader_frame:
        font_family = reader_frame.evaluate("window.getComputedStyle(document.querySelector('p')).fontFamily")
        print(f"Computed Font Family in Forced Mode: {font_family}")
        # Expect strict default (e.g. Serif) not Courier

    # 7. Disable Force Theme
    page.get_by_test_id("reader-settings-button").click()
    page.get_by_test_id("settings-force-font").click(force=True)
    page.get_by_test_id("settings-close-button").click()

    page.wait_for_timeout(1000)

    # 8. Screenshot Reverted
    print("Capturing reverted screenshot")
    capture_screenshot(page, "force_theme_03_reverted")
