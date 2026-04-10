import pytest
import re
import time
from playwright.sync_api import Page, expect
from verification import utils

def test_timeout_protection(page: Page):
    """Verify that Pause -> Play sequences taking > 5 seconds do NOT trigger a bookmark."""
    print("Testing Timeout Protection (Pause > 5s)...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    page.locator("[data-testid^='book-card-']").first.click()
    utils.navigate_to_chapter(page, chapter_id="toc-item-6")
    
    # Wait for TTS queue sync
    page.wait_for_function("() => window.useTTSStore.getState().queue.length > 0", timeout=15000)

    # Start Playback
    page.get_by_test_id("compass-pill-active").get_by_label("Play").click()
    expect(page.get_by_test_id("compass-pill-active").get_by_label("Pause")).to_be_visible(timeout=5000)
    page.wait_for_timeout(1000)

    # Pause
    page.get_by_test_id("compass-pill-active").get_by_label("Pause").click()
    expect(page.get_by_test_id("compass-pill-active").get_by_label("Play")).to_be_visible(timeout=5000)

    # Wait 6 seconds (timeout threshold is 5s)
    print("Waiting 6 seconds to exceed capture window...")
    page.wait_for_timeout(6000)

    # Play again — should NOT trigger Dragnet
    page.get_by_test_id("compass-pill-active").get_by_label("Play").click()
    page.wait_for_timeout(2000)

    # Verify NO bookmark in store
    bookmark_exists = page.evaluate("""
        () => Object.values(window.useAnnotationStore.getState().annotations).some(a => a.type === 'audio-bookmark')
    """)
    assert not bookmark_exists, "Bookmark should NOT have been created after 6 second pause"
    utils.capture_screenshot(page, "edge_timeout_protection")
    print("Timeout protection verified.")

def test_navigation_guard(page: Page):
    """Verify that navigating to a new chapter during a pause prevents capturing stale context."""
    print("Testing Navigation Guard...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    page.locator("[data-testid^='book-card-']").first.click()
    utils.navigate_to_chapter(page, chapter_id="toc-item-3")
    
    # Wait for queue to load for this chapter
    page.wait_for_function("() => window.useTTSStore.getState().queue.length > 0", timeout=15000)

    # Start Playback
    page.get_by_test_id("compass-pill-active").get_by_label("Play").click()
    expect(page.get_by_test_id("compass-pill-active").get_by_label("Pause")).to_be_visible(timeout=5000)
    page.wait_for_timeout(1000)

    # Pause — this sets lastUserPauseTimestamp
    page.get_by_test_id("compass-pill-active").get_by_label("Pause").click()
    expect(page.get_by_test_id("compass-pill-active").get_by_label("Play")).to_be_visible(timeout=5000)

    # Navigate to a DIFFERENT chapter — this should clear lastUserPauseTimestamp
    print("Navigating to Chapter 5 during pause...")
    utils.navigate_to_chapter(page, chapter_id="toc-item-6")
    
    # Wait for TTS queue to reload for the new chapter
    page.wait_for_function("""
        () => {
            const queue = window.useTTSStore.getState().queue;
            return queue.length > 0;
        }
    """, timeout=15000)
    
    # Small stabilization wait for queue to fully settle
    page.wait_for_timeout(1000)

    # Play — should NOT trigger Dragnet because navigation cleared the timestamp
    page.get_by_test_id("compass-pill-active").get_by_label("Play").click()
    page.wait_for_timeout(2000)

    # Verify NO bookmark in store
    print("Verifying no stale bookmark was created...")
    bookmark_exists = page.evaluate("""
        () => Object.values(window.useAnnotationStore.getState().annotations).some(a => a.type === 'audio-bookmark')
    """)
    assert not bookmark_exists, "Bookmark should NOT have been created after navigation"
    utils.capture_screenshot(page, "edge_navigation_guard")
    print("Navigation guard verified.")

def test_inline_hud_discard(page: Page):
    """Verify that discarding a bookmark via the Triage HUD works correctly."""
    print("Testing Inline HUD Discard...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    page.locator("[data-testid^='book-card-']").first.click()
    utils.navigate_to_chapter(page, chapter_id="toc-item-6")
    
    # Wait for TTS queue sync
    page.wait_for_function("() => window.useTTSStore.getState().queue.length > 0", timeout=15000)

    # Trigger bookmark via gesture
    print("Triggering bookmark gesture...")
    page.get_by_test_id("compass-pill-active").get_by_label("Play").click()
    expect(page.get_by_test_id("compass-pill-active").get_by_label("Pause")).to_be_visible(timeout=5000)
    page.wait_for_timeout(1000)
    
    page.get_by_test_id("compass-pill-active").get_by_label("Pause").click()
    expect(page.get_by_test_id("compass-pill-active").get_by_label("Play")).to_be_visible(timeout=5000)
    
    page.get_by_test_id("compass-pill-active").get_by_label("Play").click()
    
    # Wait for bookmark to appear in store
    print("Waiting for bookmark to appear in store...")
    page.wait_for_function("""
        () => Object.values(window.useAnnotationStore.getState().annotations).some(a => a.type === 'audio-bookmark')
    """, timeout=10000)

    # Programmatically trigger triage mode via the store
    # (bypasses unreliable epub.js iframe SVG underline DOM)
    print("Opening Triage HUD programmatically...")
    page.evaluate("""
        () => {
            const store = window.useAnnotationStore.getState();
            const bookmark = Object.values(store.annotations).find(a => a.type === 'audio-bookmark');
            if (bookmark) {
                window.useReaderUIStore.getState().setCompassState({
                    variant: 'audio-triage',
                    targetAnnotation: bookmark
                });
            }
        }
    """)

    # Verify Triage HUD is visible
    print("Verifying Triage HUD state...")
    expect(page.get_by_test_id("compass-pill-triage")).to_be_visible(timeout=5000)
    discard_btn = page.get_by_role("button", name="Discard")
    expect(discard_btn).to_be_visible()
    utils.capture_screenshot(page, "edge_hud_discard_before")

    # Click Discard
    print("Clicking Discard in HUD...")
    discard_btn.click()
    
    # Verify HUD returns to normal and bookmark is gone from store
    expect(page.get_by_test_id("compass-pill-triage")).not_to_be_visible()
    
    bookmark_exists = page.evaluate("""
        () => Object.values(window.useAnnotationStore.getState().annotations).some(a => a.type === 'audio-bookmark')
    """)
    assert not bookmark_exists, "Bookmark should have been deleted from the store"
    utils.capture_screenshot(page, "edge_hud_discard_after")
    print("Inline HUD discard verified.")

def test_section_start_boundary(page: Page):
    """Verify that bookmarking at the very start of a section works (handles index 0)."""
    print("Testing Section Start Boundary...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    page.locator("[data-testid^='book-card-']").first.click()
    utils.navigate_to_chapter(page, chapter_id="toc-item-6")
    
    # Wait for TTS queue sync but do NOT play yet
    page.wait_for_function("() => window.useTTSStore.getState().queue.length > 0", timeout=15000)

    # At index 0: Play briefly -> Pause -> Play
    print("Triggering gesture at index 0...")
    page.get_by_test_id("compass-pill-active").get_by_label("Play").click()
    page.wait_for_timeout(200)  # Very brief play
    page.get_by_test_id("compass-pill-active").get_by_label("Pause").click()
    page.get_by_test_id("compass-pill-active").get_by_label("Play").click()
    
    # Wait for bookmark to appear in store
    page.wait_for_function("""
        () => Object.values(window.useAnnotationStore.getState().annotations).some(a => a.type === 'audio-bookmark')
    """, timeout=10000)

    # Verify bookmark has text content
    bookmark = page.evaluate("""
        () => Object.values(window.useAnnotationStore.getState().annotations).find(a => a.type === 'audio-bookmark')
    """)
    assert bookmark, "Bookmark should be created at section start"
    assert len(bookmark['text']) > 0, "Bookmark should have text content even at start"
    utils.capture_screenshot(page, "edge_section_start")
    print("Section start boundary verified.")
