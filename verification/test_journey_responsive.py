import pytest
from playwright.sync_api import Page, expect
from verification import utils

VIEWPORTS = [
    ("mobile_small", 320, 568),
    ("mobile_standard", 375, 667),
    ("mobile_large", 414, 896),
    ("tablet_portrait", 768, 1024),
    ("tablet_landscape", 1024, 768),
    ("desktop_small", 1280, 800),
    ("desktop_large", 1920, 1080),
]

@pytest.mark.parametrize("name, width, height", VIEWPORTS)
def test_journey_responsive_library(page: Page, name, width, height):
    print(f"Starting Responsive Library: {name}...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    page.set_viewport_size({"width": width, "height": height})
    # Wait for layout shift
    page.wait_for_timeout(1000)

    expect(page.get_by_test_id("library-view")).to_be_visible()
    utils.capture_screenshot(page, f"responsive_library_{name}")

@pytest.mark.parametrize("name, width, height", VIEWPORTS)
def test_journey_responsive_reader(page: Page, name, width, height):
    print(f"Starting Responsive Reader: {name}...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    page.locator("[data-testid^='book-card-']").first.click()
    # Wait for reader
    expect(page.get_by_test_id("reader-view")).to_be_visible()

    # Navigate to a middle chapter to verify text layout
    utils.navigate_to_chapter(page)

    page.set_viewport_size({"width": width, "height": height})
    page.wait_for_timeout(1000)
    utils.capture_screenshot(page, f"responsive_reader_{name}")
