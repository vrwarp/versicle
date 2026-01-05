import pytest
from playwright.sync_api import Page, expect
from verification import utils
import os

def test_drag_drop_import(page: Page):
    print("Starting Drag and Drop Import Journey...")
    utils.reset_app(page)

    # 1. Verify Empty Library
    # Wait for potential migration overlay to clear if it appears
    try:
        expect(page.get_by_text("Updating Library")).not_to_be_visible(timeout=5000)
    except:
        pass # If it wasn't visible, that's fine.

    expect(page.get_by_text("Your library is empty")).to_be_visible()
    utils.capture_screenshot(page, "drag_drop_1_empty")

    # 2. Drag and Drop a file
    # We use alice.epub from verification folder
    file_path = "verification/alice.epub"

    # Read file binary
    with open(file_path, "rb") as f:
        file_content = f.read()
        # Convert to list of ints for JS serialization
        file_buffer = list(file_content)

    print("Simulating drop...")
    page.evaluate(
        """
        ([content, name]) => {
            const blob = new Blob([new Uint8Array(content)], { type: 'application/epub+zip' });
            const file = new File([blob], name, { type: 'application/epub+zip' });
            const dt = new DataTransfer();
            dt.items.add(file);

            const dropEvent = new DragEvent('drop', {
                bubbles: true,
                cancelable: true,
                dataTransfer: dt
            });

            const target = document.querySelector('[data-testid="library-view"]');
            if (target) {
                target.dispatchEvent(dropEvent);
            } else {
                throw new Error("Target not found");
            }
        }
        """,
        [file_buffer, "alice.epub"]
    )

    # 3. Verify Success Toast
    expect(page.get_by_text("Book imported successfully")).to_be_visible(timeout=30000)

    # 4. Verify Book Appears
    expect(page.locator("[data-testid^='book-card-']").first).to_be_visible()
    utils.capture_screenshot(page, "drag_drop_2_success")

    # 5. Drag invalid file
    print("Simulating invalid drop...")
    page.evaluate(
        """
        () => {
            const file = new File(['dummy'], 'test.pdf', { type: 'application/pdf' });
            const dt = new DataTransfer();
            dt.items.add(file);

            const dropEvent = new DragEvent('drop', {
                bubbles: true,
                cancelable: true,
                dataTransfer: dt
            });

            const target = document.querySelector('[data-testid="library-view"]');
            if (target) {
                target.dispatchEvent(dropEvent);
            }
        }
        """
    )

    # Verify Error Toast
    expect(page.get_by_text("Only .epub files are supported")).to_be_visible()
    utils.capture_screenshot(page, "drag_drop_3_error")

    print("Drag and Drop Journey Passed!")
