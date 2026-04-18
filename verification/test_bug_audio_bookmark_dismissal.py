import pytest
from playwright.sync_api import Page, expect
from verification import utils

def test_audio_bookmark_dismissal(page: Page):
    print("Starting Audio Bookmark Dismissal Test...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # 1. Open Book
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-back-button")).to_be_visible()

    # 2. Programmatically trigger triage mode (to save time)
    print("Triggering audio-triage mode...")
    page.evaluate("""
        () => {
            window.useReaderUIStore.getState().setCompassState({
                variant: 'audio-triage',
                targetAnnotation: {
                    id: 'test-id',
                    type: 'audio-bookmark',
                    cfiRange: 'epubcfi(/6/4[chap1]!/4/2/2)',
                    text: 'test text',
                    bookId: 'test-book-id'
                }
            });
        }
    """)

    # Verify transition
    expect(page.get_by_test_id("compass-pill-triage")).to_be_visible(timeout=5000)
    print("Triage mode active.")

    # 3. Click elsewhere (on the reader header)
    print("Clicking elsewhere to dismiss...")
    utils.capture_screenshot(page, "dismiss_before_header_click")
    # Click on the header, but at a position that's likely empty in mobile (avoiding icons)
    page.get_by_test_id("reader-header").click(position={'x': 2, 'y': 2})
    utils.capture_screenshot(page, "dismiss_after_header_click")

    # 4. Expect dismissal
    print("Verifying dismissal...")
    expect(page.get_by_test_id("compass-pill-triage")).not_to_be_visible(timeout=5000)
    
    # 5. Try clicking inside the iframe (if possible)
    # We'll trigger triage mode again
    page.evaluate("""
        () => {
            window.useReaderUIStore.getState().setCompassState({
                variant: 'audio-triage',
                targetAnnotation: {
                    id: 'test-id',
                    type: 'audio-bookmark',
                    cfiRange: 'epubcfi(/6/4[chap1]!/4/2/2)',
                    text: 'test text',
                    bookId: 'test-book-id'
                }
            });
        }
    """)
    expect(page.get_by_test_id("compass-pill-triage")).to_be_visible(timeout=5000)
    
    # Click inside the iframe container click
    page.get_by_test_id("reader-iframe-container").click(position={'x': 10, 'y': 10})
    expect(page.get_by_test_id("compass-pill-triage")).not_to_be_visible(timeout=5000)

    # 6. Test X button dismissal
    print("Testing X button dismissal...")
    page.evaluate("""
        () => {
            window.useReaderUIStore.getState().setCompassState({
                variant: 'audio-triage',
                targetAnnotation: {
                    id: 'test-id',
                    type: 'audio-bookmark',
                    cfiRange: 'epubcfi(/6/4[chap1]!/4/2/2)',
                    text: 'test text',
                    bookId: 'test-book-id'
                }
            });
        }
    """)
    expect(page.get_by_test_id("compass-pill-triage")).to_be_visible(timeout=5000)
    page.get_by_label("Dismiss review").click()
    expect(page.get_by_test_id("compass-pill-triage")).not_to_be_visible(timeout=5000)

    print("Audio Bookmark Dismissal Test Passed!")
