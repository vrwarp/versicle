import re
import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_visual_settings(page: Page):
    print("Starting Visual Settings Journey...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    page.locator('[data-testid="book-card"]').click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))
    page.wait_for_timeout(2000)

    # Open Visual Settings Popover
    print("Opening Visual Settings...")
    visual_btn = page.get_by_test_id("reader-visual-settings-button")
    visual_btn.click()

    # Verify Popover content
    expect(page.get_by_text("Ambience")).to_be_visible()
    expect(page.get_by_text("Legibility")).to_be_visible()
    expect(page.get_by_text("Layout")).to_be_visible()
    utils.capture_screenshot(page, "visual_settings_01_open")

    # Navigate to text page first
    print("Navigating to text page...")
    # Close popover by clicking outside
    page.locator('body').click(position={'x': 10, 'y': 10})

    page.get_by_test_id("reader-next-page").click()
    page.wait_for_timeout(1000)
    page.get_by_test_id("reader-next-page").click()
    page.wait_for_timeout(1000)

    # Re-open visual settings
    visual_btn.click()

    # 1. Test Theme Switching
    print("Testing Theme Switching (Sepia)...")
    sepia_btn = page.locator('button[aria-label="Select sepia theme"]')
    sepia_btn.click()
    page.wait_for_timeout(1000)
    utils.capture_screenshot(page, "visual_settings_02_sepia")

    # Verify body background color in iframe (approximate check via JS)
    # Note: content_frame returns a FrameLocator which doesn't have evaluate.
    # We need to resolve it to a Frame or use locator().evaluate()
    # But wait, FrameLocator maps to Frame. But playwright API is tricky.
    # page.frame_locator(...) returns FrameLocator.
    # To get Frame object we might need page.frames... but iframe name is dynamic.

    # Easier way: evaluate on the element inside the frame
    frame_loc = page.locator('[data-testid="reader-iframe-container"] iframe').content_frame

    # Wait for body
    frame_loc.locator("body").wait_for(timeout=2000)

    # Verify Outer UI Theme (ThemeSynchronizer)
    # This checks if the main document HTML has the 'sepia' class or style
    # The ThemeSynchronizer applies the class to document.documentElement
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
    # We check html element style or body style
    # epub.js often sets font-size on html element for resizing
    # But we set it via theme on register.

    # Let's check computed style of a paragraph if possible, or body
    font_size = frame_loc.locator("body").evaluate("element => getComputedStyle(element).fontSize")
    print(f"Font Size Style: {font_size}")
    # If not on HTML, check store or visual check

    # 3. Test Layout (Scrolled)
    print("Testing Layout Switching (Scrolled)...")
    # Tabs trigger
    scrolled_tab = page.get_by_role("tab", name="Scrolled")
    scrolled_tab.click()
    page.wait_for_timeout(2000)
    utils.capture_screenshot(page, "visual_settings_04_scrolled")

    # Verify scrollable
    # In scrolled mode, the wrapper div has overflow auto
    wrapper_overflow = page.evaluate("""() => {
        const wrapper = document.querySelector('[data-testid="reader-iframe-container"] div.epub-view');
        return wrapper ? getComputedStyle(wrapper).overflowY : 'unknown';
    }""")
    # Note: epub.js creates a wrapper div inside our container.
    # Ideally we check if iframe height is large or if scroll exists.

    # For now, just screenshot verification that it didn't crash.

    print("Visual Settings Journey Passed!")
