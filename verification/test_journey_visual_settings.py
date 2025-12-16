import re
import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_visual_settings(page: Page):
    print("Starting Visual Settings Journey...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))
    page.wait_for_timeout(2000)

    # Navigate to text page first (Chapter 5)
    print("Navigating to text page via TOC...")
    utils.navigate_to_chapter(page)
    # Ensure focus
    page.locator('[data-testid="reader-iframe-container"]').click()

    # Open Visual Settings Popover
    print("Opening Visual Settings...")
    visual_btn = page.get_by_test_id("reader-visual-settings-button")
    visual_btn.click()

    # Verify Popover content
    expect(page.get_by_text("Ambience")).to_be_visible()
    expect(page.get_by_text("Legibility")).to_be_visible()
    expect(page.get_by_text("Layout")).to_be_visible()
    utils.capture_screenshot(page, "visual_settings_01_open")

    # 1. Test Theme Switching
    print("Testing Theme Switching (Sepia)...")
    sepia_btn = page.locator('button[aria-label="Select sepia theme"]')
    sepia_btn.click()
    page.wait_for_timeout(1000)
    utils.capture_screenshot(page, "visual_settings_02_sepia")

    # Verify Outer UI Theme (ThemeSynchronizer)
    main_html_class = page.locator("html").get_attribute("class")
    print(f"Main HTML Class: {main_html_class}")

    # Verify Button State
    is_sepia_active = sepia_btn.evaluate("el => el.classList.contains('ring-2')")
    print(f"Sepia Button Active: {is_sepia_active}")

    assert main_html_class and "sepia" in main_html_class, "Main document does not have sepia class"
    assert is_sepia_active, "Sepia button is not active"

    print("Testing Theme Switching (Dark)...")
    dark_btn = page.locator('button[aria-label="Select dark theme"]')
    dark_btn.click()
    page.wait_for_timeout(1000)
    utils.capture_screenshot(page, "visual_settings_03_dark")

    # Verify Outer UI Theme (Dark)
    main_html_class_dark = page.locator("html").get_attribute("class")
    print(f"Main HTML Class (Dark): {main_html_class_dark}")

    is_dark_active = dark_btn.evaluate("el => el.classList.contains('ring-2')")
    print(f"Dark Button Active: {is_dark_active}")

    assert main_html_class_dark and "dark" in main_html_class_dark, "Main document does not have dark class"
    assert is_dark_active, "Dark button is not active"

    # 2. Test Font Size
    print("Testing Font Size...")
    increase_font_btn = page.locator('button[aria-label="Increase font size"]')
    increase_font_btn.click()
    increase_font_btn.click()
    page.wait_for_timeout(1000)

    # Check font size in iframe
    frame_loc = page.locator('[data-testid="reader-iframe-container"] iframe').content_frame

    # Wait for body
    frame_loc.locator("body").wait_for(timeout=2000)

    font_size = frame_loc.locator("body").evaluate("element => getComputedStyle(element).fontSize")
    print(f"Font Size Style: {font_size}")

    # 3. Test Layout (Scrolled)
    print("Testing Layout Switching (Scrolled)...")
    # Tabs trigger
    scrolled_tab = page.get_by_role("tab", name="Scrolled")
    scrolled_tab.click()
    page.wait_for_timeout(2000)
    utils.capture_screenshot(page, "visual_settings_04_scrolled")

    # Close the popover to see the content clearly
    # We can click outside, e.g. top left corner
    page.mouse.click(10, 10)
    page.wait_for_timeout(500)

    # Verify Compass Pill is visible (Audio HUD)
    # The compass pill should be visible in read mode
    expect(page.get_by_test_id("compass-pill-active")).to_be_visible()

    # Verify we can scroll to the bottom and text is not obscured by the pill
    print("Scrolling to bottom to verify padding...")

    # Scroll the iframe body to the bottom
    # FrameLocator does not have evaluate, we need to access the element via locator
    frame_loc.locator("html").evaluate("el => el.ownerDocument.defaultView.scrollTo(0, el.ownerDocument.body.scrollHeight)")
    page.wait_for_timeout(1000)

    # Verify that the iframe has padding applied (indirectly via screenshot, or directly via evaluation)
    # The fix applied padding to the iframe element itself in the ReaderView
    # Let's check the computed style of the iframe
    iframe_padding_bottom = page.locator('[data-testid="reader-iframe-container"] iframe').evaluate("el => getComputedStyle(el).paddingBottom")
    print(f"Iframe Padding Bottom: {iframe_padding_bottom}")

    # It should be 150px
    assert iframe_padding_bottom == "150px", f"Expected padding-bottom 150px, got {iframe_padding_bottom}"

    utils.capture_screenshot(page, "visual_settings_05_scrolled_bottom")

    print("Visual Settings Journey Passed!")
