import pytest
from playwright.sync_api import Page, expect
import re
from verification import utils

def test_journey_highlight_play(page: Page):
    print("Starting Highlight Play Journey...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-back-button")).to_be_visible(timeout=5000)

    # Wait for iframe content
    frame = page.locator('[data-testid="reader-iframe-container"] iframe').content_frame
    frame.locator("body").wait_for(timeout=5000)

    # Navigate to a page with text (Next Page)
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(2000)

    # Select Text
    print("Selecting text...")
    selection_success = frame.locator("body").evaluate("""
        () => {
            try {
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
                let node = walker.nextNode();
                // Find a text node with enough length
                while(node) {
                    if (node.textContent.trim().length > 20) {
                        break;
                    }
                    node = walker.nextNode();
                }

                if (node) {
                    const range = document.createRange();
                    range.setStart(node, 0);
                    range.setEnd(node, 10);
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);

                    document.dispatchEvent(new MouseEvent('mouseup', {
                        view: window,
                        bubbles: true,
                        cancelable: true,
                        clientX: 100,
                        clientY: 100
                    }));
                    return true;
                }
                return false;
            } catch (e) {
                return false;
            }
        }
    """)

    if not selection_success:
        pytest.fail("Could not select text.")

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

    # Wait for it to start speaking (data-status="start" or "speaking")
    expect(debug).to_have_attribute("data-status", re.compile(r"start|speaking"), timeout=10000)

    # Verify popover is gone
    expect(play_btn).not_to_be_visible()

    utils.capture_screenshot(page, "highlight_play_started")
    print("Highlight Play Journey Passed!")
