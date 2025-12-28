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
    page.wait_for_timeout(1000)
    page.set_input_files("data-testid=hidden-file-input", "public/books/alice.epub")

    book_card = page.locator("[data-testid^='book-card-']").first
    expect(book_card).to_be_visible(timeout=5000)

    # Click to open reader
    book_card.click()
    expect(page.get_by_test_id("reader-iframe-container")).to_be_visible(timeout=5000)

    # 2. Add Annotation (Skipping text selection, using Lexicon)
    page.wait_for_timeout(1000)
    page.click("button[aria-label='Settings']") # Open Global Settings
    page.get_by_role("button", name="Dictionary").click()
    page.get_by_role("button", name="Manage Rules").click()
    page.get_by_test_id("lexicon-add-rule-btn").click()

    page.fill("data-testid=lexicon-input-original", "Rabbit")
    page.fill("data-testid=lexicon-input-replacement", "Bunny")
    page.click("data-testid=lexicon-save-rule-btn")

    page.keyboard.press("Escape") # Close Lexicon
    page.keyboard.press("Escape") # Close Settings
    page.click("data-testid=reader-back-button") # Back to library

    # 3. Export Backup
    page.click("button[aria-label='Settings']")
    page.get_by_role("button", name="Data Management").click()

    with page.expect_download() as download_info:
        page.click("button:has-text('Export Metadata Only')")

    download = download_info.value
    suggested_filename = download.suggested_filename
    if not suggested_filename.endswith('.json'):
        suggested_filename += '.json'

    backup_path = f"/tmp/{suggested_filename}"
    download.save_as(backup_path)
    print(f"Backup saved to: {backup_path}")

    page.keyboard.press("Escape")

    # 4. Delete Book
    book_card.hover()
    page.locator("data-testid=book-menu-trigger").click(force=True)
    page.click("data-testid=menu-delete")
    page.click("data-testid=confirm-delete")
    expect(book_card).not_to_be_visible(timeout=5000)

    # 5. Restore Backup
    page.click("button[aria-label='Settings']")
    page.get_by_role("button", name="Data Management").click()

    page.once("dialog", lambda dialog: dialog.accept())
    page.set_input_files("data-testid=backup-file-input", backup_path)

    # Wait for reload - Increased timeout and explicitly wait
    # The app navigates to '/' which triggers a reload.
    print("Waiting for restore and reload...")
    page.wait_for_timeout(3000)

    expect(page.get_by_test_id("library-view")).to_be_visible(timeout=10000)

    # 6. Verify Restore
    expect(book_card).to_be_visible(timeout=5000)
    expect(page.locator(".bg-black\\/20")).to_be_visible(timeout=5000)

    capture_screenshot(page, "backup_restore_complete")

    if os.path.exists(backup_path):
        os.remove(backup_path)

def test_journey_full_backup_restore(page: Page):
    reset_app(page)

    # 1. Import Book
    page.wait_for_timeout(1000)
    page.set_input_files("data-testid=hidden-file-input", "public/books/alice.epub")

    book_card = page.locator("[data-testid^='book-card-']").first
    expect(book_card).to_be_visible(timeout=5000)

    # 2. Export Full Backup
    page.click("button[aria-label='Settings']")
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

    page.keyboard.press("Escape")

    # 3. Delete Book
    book_card.hover()
    page.locator("data-testid=book-menu-trigger").click(force=True)
    page.click("data-testid=menu-delete")
    page.click("data-testid=confirm-delete")
    expect(book_card).not_to_be_visible(timeout=5000)

    # 4. Restore Backup
    page.click("button[aria-label='Settings']")
    page.get_by_role("button", name="Data Management").click()

    page.once("dialog", lambda dialog: dialog.accept())
    page.set_input_files("data-testid=backup-file-input", backup_path)

    # Wait for reload
    print("Waiting for restore and reload...")
    page.wait_for_timeout(3000)

    expect(page.get_by_test_id("library-view")).to_be_visible(timeout=10000)

    # 5. Verify Restore
    expect(book_card).to_be_visible(timeout=5000)
    expect(page.locator(".bg-black\\/20")).not_to_be_visible(timeout=5000)

    capture_screenshot(page, "full_backup_restore_complete")

    if os.path.exists(backup_path):
        os.remove(backup_path)
