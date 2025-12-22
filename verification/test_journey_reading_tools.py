import pytest
import re
from playwright.sync_api import Page, expect
from verification import utils

def test_journey_reading_tools(page: Page):
    print("Starting Reading Tools Journey (Annotations & Highlight Play)...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-back-button")).to_be_visible(timeout=5000)

    # Wait for iframe content
    frame = page.locator('[data-testid="reader-iframe-container"] iframe').content_frame
    frame.locator("body").wait_for(timeout=5000)

    # Navigate to Chapter 5 via TOC to ensure we have content
    print("Navigating to Chapter 5...")
    utils.navigate_to_chapter(page)

    # Helper script to select text
    # We add an offset to select different text if needed, or we just select first available text.
    def select_text_script(skip_count=0):
        return f"""
        () => {{
            try {{
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
                let node = walker.nextNode();
                let found = 0;
                // Find a text node with enough length
                while(node) {{
                    if (node.textContent.trim().length > 20) {{
                        if (found >= {skip_count}) {{
                            break;
                        }}
                        found++;
                    }}
                    node = walker.nextNode();
                }}

                if (node) {{
                    const range = document.createRange();
                    range.setStart(node, 0);
                    range.setEnd(node, 10);
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);

                    document.dispatchEvent(new MouseEvent('mouseup', {{
                        view: window,
                        bubbles: true,
                        cancelable: true,
                        clientX: 100,
                        clientY: 100
                    }}));
                    return true;
                }}
                return false;
            }} catch (e) {{
                return false;
            }}
        }}
        """

    # 1. Create Highlight
    print("Creating Highlight...")
    selection_success = frame.locator("body").evaluate(select_text_script(skip_count=0))
    if not selection_success:
        pytest.fail("Could not select text for highlighting.")

    # Click Yellow Highlight
    expect(page.get_by_test_id("popover-color-yellow")).to_be_visible(timeout=3000)
    page.get_by_test_id("popover-color-yellow").click()
    expect(page.get_by_test_id("popover-color-yellow")).not_to_be_visible(timeout=5000)

    utils.capture_screenshot(page, "tools_1_highlight_created")

    # 2. Highlight Play (TTS)
    print("Testing Highlight Play...")
    # Select DIFFERENT text (skip the first one we just highlighted)
    selection_success = frame.locator("body").evaluate(select_text_script(skip_count=1))
    if not selection_success:
        # Fallback: maybe navigate to next page?
        print("Could not find second text node, trying next page...")
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(1000)
        selection_success = frame.locator("body").evaluate(select_text_script(skip_count=0))
        if not selection_success:
             pytest.fail("Could not select text for play.")

    # Check for Play Button
    play_btn = page.get_by_test_id("popover-play-button")
    expect(play_btn).to_be_visible(timeout=3000)

    # Click Play Button
    print("Clicking Play button...")
    play_btn.click()

    # Verify Playback Started
    # Check the debug element from mock TTS
    debug = page.locator("#tts-debug")
    expect(debug).to_be_visible()
    expect(debug).to_have_attribute("data-status", re.compile(r"start|speaking"), timeout=10000)

    utils.capture_screenshot(page, "tools_2_play_started")

    # 3. Reload Page (Persistence Check)
    print("Reloading page to check highlight persistence...")
    page.reload()

    # Wait for book to reload
    expect(page.get_by_test_id("reader-back-button")).to_be_visible(timeout=5000)
    frame = page.locator('[data-testid="reader-iframe-container"] iframe').content_frame
    frame.locator("body").wait_for(timeout=5000)
    page.wait_for_timeout(2000)

    # 4. Verify Highlight Persisted
    print("Verifying annotations reapplied after reload...")
    # Check via sidebar
    page.get_by_test_id("reader-annotations-button").click()
    expect(page.get_by_test_id("reader-annotations-sidebar")).to_be_visible(timeout=5000)
    expect(page.locator("li[data-testid^='annotation-item-']").first).to_be_visible(timeout=5000)

    utils.capture_screenshot(page, "tools_3_sidebar_check")

    print("Reading Tools Journey Passed!")
