
import os
import time
from playwright.sync_api import sync_playwright, expect

def verify_book_action_menu():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()

        try:
            print("Loading library page...")
            page.goto("http://localhost:5173")
            expect(page.get_by_role("heading", name="My Library")).to_be_visible(timeout=10000)

            # Check if empty
            if page.get_by_text("Your library is empty").is_visible():
                print("Library is empty.")
                print("Injecting dummy book via console...")

                # More robust injection logic
                page.evaluate("""
                    const existing = localStorage.getItem('library-storage');
                    let store = { state: { books: [] } };
                    if (existing) {
                        try {
                            store = JSON.parse(existing);
                        } catch (e) {
                            console.error('Failed to parse existing storage', e);
                        }
                    }
                    if (!store.state) store.state = { books: [] };
                    if (!store.state.books) store.state.books = [];

                    if (store.state.books.length === 0) {
                        store.state.books.push({
                            id: 'test-book-1',
                            title: 'Test Book',
                            author: 'Test Author',
                            addedAt: Date.now(),
                            progress: 0,
                            isOffloaded: false,
                            coverBlob: null // Simplified
                        });
                        localStorage.setItem('library-storage', JSON.stringify(store));
                        // Force reload to apply changes
                    }
                """)
                print("Reloading page...")
                page.reload()
                expect(page.get_by_text("Test Book")).to_be_visible(timeout=5000)

            print("Opening action menu...")
            # Using data-testid
            card = page.get_by_text("Test Book")
            card.hover()

            trigger = page.get_by_test_id("book-menu-trigger").first
            expect(trigger).to_be_visible()
            trigger.click()

            print("Verifying menu items...")
            menu_content = page.locator('[role="menu"]')
            expect(menu_content).to_be_visible()
            expect(page.get_by_test_id("menu-offload")).to_be_visible()
            expect(page.get_by_test_id("menu-delete")).to_be_visible()

            print("Taking screenshot of open menu...")
            page.screenshot(path="verification/book_action_menu.png")

            print("Clicking delete...")
            page.get_by_test_id("menu-delete").click()

            expect(page.get_by_role("dialog")).to_be_visible()
            expect(page.get_by_text("Delete Book")).to_be_visible()

            print("Taking screenshot of delete dialog...")
            page.screenshot(path="verification/delete_dialog.png")

            page.get_by_text("Cancel").click()
            expect(page.get_by_role("dialog")).not_to_be_visible()
            print("Verification successful.")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
            raise e
        finally:
            browser.close()

if __name__ == "__main__":
    verify_book_action_menu()
