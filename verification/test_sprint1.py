
import pytest
from playwright.sync_api import Page, expect

def test_immersive_mode(page: Page):
    """
    Test the immersive mode functionality:
    1. Load a book.
    2. Click in the center to toggle immersive mode (hide header/footer).
    3. Click again to show header/footer.
    """

    page.goto('http://localhost:5173/')

    # Wait for library to load
    expect(page.get_by_text("Library")).to_be_visible()

    # Upload book if not present
    if page.get_by_text("Alice's Adventures in Wonderland").count() == 0:
        # Use the input directly
        page.set_input_files("input[type='file']", "src/test/fixtures/alice.epub")
        # Wait for processing
        expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible(timeout=10000)

    # Click on the book to open reader
    # Use force click if needed or ensure visibility
    page.click("text=Alice's Adventures in Wonderland")

    # Wait for reader view
    expect(page.get_by_test_id("reader-iframe-container")).to_be_visible(timeout=10000)

    # Check header is visible initially
    header = page.locator("header")
    expect(header).to_be_visible()

    # Screenshot 1: Default View
    page.screenshot(path="verification/screenshots/sprint1_1_default.png")

    # Wait for book content to be fully loaded and interactive
    # The click listener is attached to the rendition, which wraps the iframe content.
    # We wait for the iframe to contain body/text to ensure it's ready.
    frame = page.frame_locator("iframe")
    frame.locator("body").wait_for(state="visible", timeout=10000)

    # Wait a bit more to ensure event listeners are attached by epub.js
    page.wait_for_timeout(2000)

    # 2. Toggle Immersive Mode
    # Click center of viewport.
    # We need to make sure we click the reader area, not the header/footer.
    viewport_size = page.viewport_size
    if viewport_size:
        x = viewport_size['width'] / 2
        y = viewport_size['height'] / 2
        page.mouse.click(x, y)

    # Wait for state update - INCREASED TIMEOUT
    page.wait_for_timeout(2000)

    # Header should be hidden
    expect(header).to_be_hidden()

    # Screenshot 2: Immersive View
    page.screenshot(path="verification/screenshots/sprint1_2_immersive.png")

    # 3. Toggle Back
    if viewport_size:
        page.mouse.click(x, y)

    page.wait_for_timeout(2000)

    # Header should be visible
    expect(header).to_be_visible()

    # Screenshot 3: Restored View
    page.screenshot(path="verification/screenshots/sprint1_3_restored.png")

def test_optimal_line_length(page: Page):
    """
    Test that the reader container has max-width and padding.
    """
    page.goto('http://localhost:5173/')

    if page.get_by_text("Alice's Adventures in Wonderland").count() == 0:
         page.set_input_files("input[type='file']", "src/test/fixtures/alice.epub")
         expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible(timeout=10000)

    page.click("text=Alice's Adventures in Wonderland")
    expect(page.get_by_test_id("reader-iframe-container")).to_be_visible(timeout=10000)

    # Check styles of the container
    container = page.get_by_test_id("reader-iframe-container")

    # We can check computed style
    # tailwind max-w-2xl is 42rem.
    # If font-size root is 16px, 42 * 16 = 672px.
    max_width = container.evaluate("el => getComputedStyle(el).maxWidth")
    # It might be in px or other unit.
    print(f"Computed max-width: {max_width}")

    # Just checking it's not 'none' is a good start, or check specific value.
    assert max_width != "none"

    # Check padding
    # px-6 is 1.5rem (24px), md:px-8 is 2rem (32px).
    # Playwright default viewport is 1280x720 (md+). So expect 32px.
    padding_left = container.evaluate("el => getComputedStyle(el).paddingLeft")
    print(f"Computed padding-left: {padding_left}")

    assert padding_left in ["24px", "32px"]

    # Screenshot 4: Layout Verification
    page.screenshot(path="verification/screenshots/sprint1_4_layout.png")
