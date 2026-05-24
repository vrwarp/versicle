
import pytest
from playwright.sync_api import Page, expect

def test_reading_history_journey(page: Page):
    # 1. Load the app (using the demo book since library might be empty)
    page.goto("/")

    # Wait for either reader view, book cards, or empty library message
    # This accommodates any prior state or slow loading under parallel load
    for _ in range(100):  # 20 seconds total wait
        if page.is_visible("[data-testid='reader-view']"):
            break
        if page.is_visible("text=Your library is empty"):
            page.click("text=Load Demo Book")
            # Wait for book card to appear after loading demo book
            page.wait_for_selector("[data-testid^='book-card-']", timeout=10000)
            page.click("[data-testid^='book-card-']:first-child")
            break
        if page.is_visible("[data-testid^='book-card-']"):
            page.click("[data-testid^='book-card-']:first-child")
            break
        page.wait_for_timeout(200)

    # Wait for reader to load
    page.wait_for_selector("[data-testid='reader-view']", timeout=15000)

    # DWELL TIME CHECK: We must stay on the initial page for > 2 seconds for history to track it
    # upon the next navigation.
    page.wait_for_timeout(3000)

    # 2. Open Table of Contents
    page.click("[data-testid='reader-toc-button']")

    # 3. Switch to History Tab
    page.click("[data-testid='tab-history']")

    # 4. Navigate to a new chapter to generate history
    page.click("[data-testid='tab-chapters']")
    page.wait_for_selector("[data-testid^='toc-item-']", timeout=5000)

    # Click a different chapter than current to ensure navigation
    page.click("[data-testid='toc-item-2']")

    # Wait for navigation to complete
    # AND WAIT FOR DWELL TIME (2s) so subsequent history is recorded if we navigate again
    # (Though we check history of the PREVIOUS segment now)
    page.wait_for_timeout(3000)

    # 5. Check History again
    page.click("[data-testid='reader-toc-button']")
    if not page.is_visible("[data-testid='reader-toc-sidebar']"):
         page.click("[data-testid='reader-toc-button']")

    page.click("[data-testid='tab-history']")

    # Should have at least one entry now.
    expect(page.locator("ul.divide-y li")).not_to_have_count(0, timeout=5000)

    # NEW CHECK: Verify date is present
    history_item = page.locator("ul.divide-y li").first
    sub_label = history_item.locator("p.text-muted-foreground").inner_text()
    assert "•" in sub_label, f"Expected date in history item, got: {sub_label}"

    # Take a screenshot for verification
    page.screenshot(path="verification/screenshots/history_with_date.png")

    # 6. Click the history item to navigate back
    history_label = history_item.locator("span").inner_text()

    history_item.click()

    # Wait for navigation
    page.wait_for_timeout(2000)

    # Verify that the history panel (sidebar) is still open
    expect(page.locator("[data-testid='reader-toc-sidebar']")).to_be_visible()

    print("Reading history journey completed successfully")
