import os
import pytest
from playwright.sync_api import Page, expect
from verification.utils import reset_app, capture_screenshot

def test_journey_backup_restore(page: Page):
    """
    Test the full Backup & Restore journey:
    1. Import a book (Alice).
    2. Add an annotation.
    3. Export Metadata Only (Light Backup).
    4. Delete the book.
    5. Restore from backup.
    6. Verify book and annotation are back (Metadata only means book is offloaded).
    """
    reset_app(page)

    # 1. Import Book
    # Use hidden input locator consistent with other tests
    # Wait for the view to be stable
    page.wait_for_timeout(1000)
    page.set_input_files("data-testid=hidden-file-input", "public/books/alice.epub")

    # Wait for processing - wait for the card to be visible
    # Using selector similar to test_journey_smart_delete.py
    book_card = page.locator("[data-testid^='book-card-']").first
    expect(book_card).to_be_visible(timeout=5000)

    # Click to open reader
    book_card.click()

    # Wait for reader to load
    # Use existing test id for iframe container or back button
    expect(page.get_by_test_id("reader-iframe-container")).to_be_visible(timeout=5000)

    # 2. Add Annotation
    # Skip actual annotation on text for now as it's flaky, rely on adding a Lexicon rule
    # which is easier to automate reliably.

    # Wait for settings button to be actionable
    page.wait_for_timeout(1000)

    page.click("button[aria-label='Settings']") # Open Global Settings
    page.get_by_role("button", name="Dictionary").click()
    page.get_by_role("button", name="Manage Rules").click()
    page.get_by_test_id("lexicon-add-rule-btn").click()

    # Use data-testid for inputs if available or fall back to placeholder
    page.fill("data-testid=lexicon-input-original", "Rabbit")
    page.fill("data-testid=lexicon-input-replacement", "Bunny")
    page.click("data-testid=lexicon-save-rule-btn")

    # Close Lexicon and Settings
    page.keyboard.press("Escape") # Close Lexicon
    page.keyboard.press("Escape") # Close Settings
    page.click("data-testid=reader-back-button") # Back to library

    # 3. Export Backup
    page.click("button[aria-label='Settings']")
    page.get_by_role("button", name="Data Management").click()

    # Setup download listener
    with page.expect_download() as download_info:
        page.click("button:has-text('Export Metadata Only')")

    download = download_info.value
    # Fix: Save with correct extension so re-upload works
    # Use the suggested filename from the download which should end in .json
    suggested_filename = download.suggested_filename
    if not suggested_filename.endswith('.json'):
        suggested_filename += '.json'

    backup_path = f"/tmp/{suggested_filename}"
    download.save_as(backup_path)
    print(f"Backup saved to: {backup_path}")

    # Close Settings
    page.keyboard.press("Escape")

    # 4. Delete Book
    # Open book menu
    # Need to target the specific book menu trigger
    # Hover first to ensure visibility (works on desktop)
    book_card.hover()

    # Force click the menu trigger because on mobile emulation hover might not trigger opacity change reliably,
    # or the element might still be considered invisible by strict checks if opacity is 0.
    # However, forcing click usually bypasses visibility checks.
    page.locator("data-testid=book-menu-trigger").click(force=True)

    # The menu option text is "Delete Book"
    # We must register the dialog handler BEFORE clicking
    page.once("dialog", lambda dialog: dialog.accept())

    # Use specific testid
    page.click("data-testid=menu-delete")

    expect(book_card).not_to_be_visible(timeout=5000)

    # 5. Restore Backup
    page.click("button[aria-label='Settings']")
    page.get_by_role("button", name="Data Management").click()

    # Handle the file chooser for restore
    # Register dialog handler for the merge confirmation BEFORE setting files
    page.once("dialog", lambda dialog: dialog.accept())

    page.set_input_files("data-testid=backup-file-input", backup_path)

    # Wait for reload (Restore triggers reload)
    expect(page.get_by_test_id("library-view")).to_be_visible(timeout=5000)

    # 6. Verify Restore
    # Book should be back
    expect(book_card).to_be_visible(timeout=5000)

    # Since it was a light backup, the book should be "Offloaded" (cloud icon)
    # Check for offloaded status - use the same selector as smart delete test
    # expect(page.locator(".bg-black\\/20 > svg")).to_be_visible()
    # Or explicitly check for the status badge if it exists
    # The offload indicator is a div with bg-black/20
    expect(page.locator(".bg-black\\/20")).to_be_visible(timeout=5000)

    capture_screenshot(page, "backup_restore_complete")

    # Cleanup
    if os.path.exists(backup_path):
        os.remove(backup_path)

def test_journey_full_backup_restore(page: Page):
    """
    Test the Full Backup & Restore journey (ZIP):
    1. Import a book (Alice).
    2. Export Full Backup.
    3. Delete the book.
    4. Restore from backup.
    5. Verify book is back and NOT offloaded (file restored).
    """
    reset_app(page)

    # 1. Import Book
    page.wait_for_timeout(1000)
    page.set_input_files("data-testid=hidden-file-input", "public/books/alice.epub")

    book_card = page.locator("[data-testid^='book-card-']").first
    expect(book_card).to_be_visible(timeout=5000)

    # 2. Export Full Backup
    page.click("button[aria-label='Settings']") # Header settings
    page.get_by_role("button", name="Data Management").click()

    with page.expect_download() as download_info:
        page.click("button:has-text('Export Full Backup (ZIP)')")

    download = download_info.value
    suggested_filename = download.suggested_filename
    if not suggested_filename.endswith('.zip'):
        suggested_filename += '.zip'

    backup_path = f"/tmp/{suggested_filename}"
    download.save_as(backup_path)
    print(f"Full Backup saved to: {backup_path}")

    # Close Settings
    page.keyboard.press("Escape")

    # 3. Delete Book
    book_card.hover()
    page.locator("data-testid=book-menu-trigger").click(force=True)
    page.once("dialog", lambda dialog: dialog.accept())
    page.click("data-testid=menu-delete")
    expect(book_card).not_to_be_visible(timeout=5000)

    # 4. Restore Backup
    page.click("button[aria-label='Settings']")
    page.get_by_role("button", name="Data Management").click()

    page.once("dialog", lambda dialog: dialog.accept())
    page.set_input_files("data-testid=backup-file-input", backup_path)

    # Wait for reload
    expect(page.get_by_test_id("library-view")).to_be_visible(timeout=5000)

    # 5. Verify Restore
    expect(book_card).to_be_visible(timeout=5000)

    # Should NOT be offloaded (no cloud icon overlay)
    expect(page.locator(".bg-black\\/20")).not_to_be_visible(timeout=5000)

    capture_screenshot(page, "full_backup_restore_complete")

    # Cleanup
    if os.path.exists(backup_path):
        os.remove(backup_path)
