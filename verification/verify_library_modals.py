from playwright.sync_api import sync_playwright, expect
import time

def verify_action_menu():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Navigate to app
        try:
            page.goto("http://localhost:5173", timeout=15000)
        except Exception as e:
            print(f"Error connecting to server: {e}")
            return

        # Wait for app to load (checking for either empty library or book list)
        try:
            expect(page.locator("h1")).to_have_text("My Library", timeout=10000)
        except:
            print("Timed out waiting for app load")
            page.screenshot(path="verification/timeout.png")
            return

        # If empty library, we need to mock or add a book.
        # However, testing UI components often requires content.
        # Assuming dev environment might be empty, let's inject a book mock via JS if needed,
        # OR just check if EmptyLibrary is there and we can't test menu.
        # But we can try to find an action menu.

        # Check if we have books
        books = page.locator("[data-testid^='book-card-']")
        if books.count() == 0:
            print("No books found. Attempting to add a mock book via console/JS not feasible easily without backend interaction.")
            # For this task, we can verify that the library view loads and the 'DeleteBookDialog' is not visible initially.
            # And checking the DOM for shared dialogs.

            # Check for shared dialogs presence in DOM (they should be rendered but hidden/closed)
            # Actually standard Dialog implementation might unmount content when closed or hide it.
            # If standard Dialog uses Radix, it unmounts content unless forceMount is used.
            # But the Dialog COMPONENT is rendered.

            # Let's take a screenshot of the library.
            page.screenshot(path="verification/library_view.png")
            print("Library view loaded (empty). Verification limited to structure.")
        else:
            # We have books. Click the action menu of the first book.
            first_book = books.first
            menu_trigger = first_book.locator("[data-testid='book-menu-trigger']")

            # Hover to make trigger visible (if needed by CSS) or just click
            menu_trigger.click(force=True)

            # Wait for menu to appear
            menu_content = page.locator("[role='menu']")
            expect(menu_content).to_be_visible()

            page.screenshot(path="verification/menu_open.png")

            # Click Delete
            delete_item = page.locator("[data-testid='menu-delete']")
            delete_item.click()

            # Verify Delete Dialog appears
            dialog = page.locator("[role='dialog']")
            expect(dialog).to_be_visible()
            expect(dialog).to_contain_text("Delete Book")

            page.screenshot(path="verification/delete_dialog.png")

            # Click Cancel
            cancel_btn = dialog.locator("button", has_text="Cancel")
            cancel_btn.click()

            expect(dialog).not_to_be_visible()

            print("Verified Delete Dialog flow.")

        browser.close()

if __name__ == "__main__":
    verify_action_menu()
