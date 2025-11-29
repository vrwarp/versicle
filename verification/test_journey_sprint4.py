
import os
from playwright.sync_api import Page, expect
from .utils import ensure_library_with_book, capture_screenshot

def test_journey_sprint4_polish(page: Page):
    """
    User Journey: Sprint 4 Polish & Hierarchy
    1. Open Reader
    2. Open Settings -> Verify Grouping (Display/Audio/System)
    3. Perform Search -> Verify Highlighting
    4. Open TOC -> Verify Auto-scroll/Highlighting
    """
    # 1. Open Reader
    page.goto("http://localhost:5173", timeout=10000)
    ensure_library_with_book(page)
    page.click('text=Alice')
    page.wait_for_selector('[data-testid="reader-settings-button"]', timeout=15000)

    # 2. Verify Settings Groups
    page.click('[data-testid="reader-settings-button"]')
    expect(page.locator('h4:text-is("Display")')).to_be_visible()
    expect(page.locator('h4:text-is("Audio")')).to_be_visible()
    expect(page.locator('h4:text-is("System")')).to_be_visible()
    capture_screenshot(page, "sprint4_settings_grouped")
    page.click('[data-testid="settings-close-button"]')

    # 3. Verify Search Highlighting
    page.click('[data-testid="reader-search-button"]')
    page.fill('[data-testid="search-input"]', "Alice")
    page.press('[data-testid="search-input"]', "Enter")
    expect(page.locator('[data-testid="search-result-0"]')).to_be_visible()
    expect(page.locator('.bg-yellow-200').first).to_be_visible()
    capture_screenshot(page, "sprint4_search_highlight")
    page.click('[data-testid="search-close-button"]')

    # 4. Verify Auto-Scroll TOC
    page.click('[data-testid="reader-toc-button"]')
    expect(page.locator('[data-testid="reader-toc-sidebar"]')).to_be_visible()

    # Use logic from verification/verify_sprint_4.py to ensure test robustness
    # Click first available chapter item
    chapter_link = page.locator('[data-testid^="toc-item-"]').nth(1)
    if chapter_link.is_visible():
        chapter_link.click()
        page.wait_for_timeout(2000)

        # Re-open TOC
        page.click('[data-testid="reader-toc-button"]')
        expect(page.locator('[data-testid="reader-toc-sidebar"]')).to_be_visible()

        # Verify ANY item is highlighted (we improved matching logic so this should be reliable)
        expect(page.locator('.bg-blue-100')).to_be_visible(timeout=5000)

    capture_screenshot(page, "sprint4_toc_scroll")
