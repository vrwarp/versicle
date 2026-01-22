import re
from playwright.sync_api import Page, expect
from verification import utils

def test_iframe_height(page: Page):
    """
    Verifies that the reader iframe container is reduced in height in paginated mode
    to accommodate the bottom navigation pill.
    """
    print("Starting Iframe Height Verification...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    print("Opening book...")
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page).to_have_url(re.compile(r".*/read/.*"))

    # Wait for reader to be ready
    page.wait_for_timeout(3000)

    # Get the container element
    container = page.locator('[data-testid="reader-iframe-container"]')
    expect(container).to_be_visible()

    # Get the bounding box of the container
    box = container.bounding_box()
    if not box:
        raise Exception("Container not found or not visible")

    container_height = box['height']

    # Get the viewport height
    viewport = page.viewport_size
    viewport_height = viewport['height']

    print(f"Container height: {container_height}")
    print(f"Viewport height: {viewport_height}")

    diff = viewport_height - container_height
    print(f"Difference (Viewport - Container): {diff}")

    # The container should be reduced by ~100px plus the header height (~50px).
    # Total difference should be around 150px.
    # We use a threshold of 140px to be safe.
    assert diff >= 140, f"Container height {container_height} is not reduced enough. Diff: {diff}"

    # Capture screenshot to see the pill overlap
    utils.capture_screenshot(page, "iframe_height_check")
