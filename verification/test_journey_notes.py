import pytest
import re
from playwright.sync_api import Page, expect
from verification import utils

def test_journey_notes(page: Page):
    print("Starting Global Notes Journey...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # 1. Switch to Notes View
    print("Switching to Notes View...")
    page.locator('button[aria-label="Select view context"]').click()
    page.locator('div[role="option"]', has_text="Notes").click()

    expect(page.get_by_text("No annotations yet")).to_be_visible()
    utils.capture_screenshot(page, "notes_1_empty")

    # Switch back to Library
    page.locator('button[aria-label="Select view context"]').click()
    page.locator('div[role="option"]', has_text="My Library").click()

    # 2. Open Book and Create Highlight
    print("Opening book and creating annotation...")
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-view")).to_be_visible(timeout=5000)

    # Wait for iframe content
    frame = page.locator('[data-testid="reader-iframe-container"] iframe').content_frame
    frame.locator("body").wait_for(timeout=5000)

    # Navigate to Chapter 5 via TOC to ensure we have content
    utils.navigate_to_chapter(page)

    # Helper script to select text
    def select_text_script(skip_count=0):
        return f"""
        () => {{
            try {{
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
                let node = walker.nextNode();
                let found = 0;
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
                    range.setEnd(node, 15);
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

    print("Creating Highlight...")
    selection_success = frame.locator("body").evaluate(select_text_script(skip_count=0))
    if not selection_success:
        pytest.fail("Could not select text for highlighting.")

    expect(page.get_by_test_id("compass-pill-annotation")).to_be_visible(timeout=5000)

    # Add a note
    page.get_by_test_id("popover-add-note-button").click()
    page.locator('textarea[placeholder="Add a note..."]').fill("This is my insightful note.")
    page.get_by_role("button", name="Save").click()
    expect(page.get_by_test_id("compass-pill-annotation-edit")).not_to_be_visible(timeout=5000)
    expect(page.get_by_test_id("compass-pill-annotation")).not_to_be_visible(timeout=5000)

    # 3. Go back to Library and Switch to Notes
    print("Returning to Library and viewing Notes...")
    page.get_by_test_id("reader-back-button").click()
    
    # Wait for library
    expect(page.locator('button[aria-label="Select view context"]')).to_be_visible(timeout=5000)

    # Switch to notes
    page.locator('button[aria-label="Select view context"]').click()
    page.locator('div[role="option"]', has_text="Notes").click()

    expect(page.get_by_test_id("global-notes-view")).to_be_visible()
    
    # Check that book block is present
    expect(page.locator("[data-testid='book-notes-block']")).to_be_visible()
    expect(page.locator("[data-testid='book-notes-block']").get_by_text("Alice's Adventures in Wonderland").first).to_be_visible()
    expect(page.locator("[data-testid='book-notes-block']").get_by_text("This is my insightful note.").first).to_be_visible()

    # Check search functionality
    print("Testing Search...")
    page.get_by_test_id("notes-search-input").fill("nonexistent string 12345")
    expect(page.get_by_text("No results found")).to_be_visible()

    # clear search
    page.get_by_test_id("notes-search-input").fill("")
    
    # 4. Deep linking
    print("Testing deep linking...")
    
    # Click on the annotation card
    page.locator("[data-testid^='annotation-card-']").first.click()

    # Verify we navigated back to reader
    expect(page).to_have_url(re.compile(r".*/read/.*\?cfi=.*"))
    expect(page.get_by_test_id("reader-view")).to_be_visible(timeout=5000)

    utils.capture_screenshot(page, "notes_2_deep_link")
    print("Global Notes Journey Passed!")
