import pytest
from playwright.sync_api import Page, expect
from verification.utils import reset_app, ensure_library_with_book, capture_screenshot

def test_hover_regression(page: Page):
    """
    Regression test for the red hover issue.
    Ensures that hovering over text elements does not turn them red,
    even if the book has stubborn styles.
    """
    reset_app(page)

    # Try to load demo book if available, else upload
    try:
        page.get_by_role("button", name="Load Demo Book").click(timeout=2000)
    except:
        ensure_library_with_book(page)

    # Open the book
    page.get_by_text("Alice's Adventures in Wonderland").click()

    # Wait for reader
    expect(page.get_by_test_id("reader-iframe-container")).to_be_visible()

    # Open TOC and go to first chapter (Chapter I) to ensure text
    page.get_by_test_id("reader-toc-button").click()
    page.get_by_test_id("toc-item-1").click()
    expect(page.get_by_test_id("reader-toc-sidebar")).not_to_be_visible()

    # Wait for iframe content
    frame = page.frame_locator("div[data-testid='reader-iframe-container'] iframe")
    p = frame.locator("p").first
    expect(p).to_be_visible(timeout=10000)

    # Inject red hover style with !important to simulate the stubborn issue
    # This simulates a book or environment that forces red hover
    frame.locator("html").evaluate("""el => {
        const style = document.createElement('style');
        style.textContent = 'p:hover { color: rgb(255, 0, 0) !important; }';
        document.head.appendChild(style);
    }""")

    # Hover over the paragraph
    p.hover()
    page.wait_for_timeout(1000)

    # Get hover color
    hover_color = p.evaluate("el => window.getComputedStyle(el).color")
    print(f"Hover color: {hover_color}")

    capture_screenshot(page, "hover_regression")

    # The bug is that it turns red.
    # We assert that it does NOT turn red.
    # If the bug exists, this should fail.
    # Red is typically rgb(255, 0, 0)
    assert hover_color != "rgb(255, 0, 0)", f"Text turned red on hover! Got {hover_color}"
