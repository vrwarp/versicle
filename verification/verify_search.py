
import time
from playwright.sync_api import sync_playwright, expect

def verify_library_user_journey():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Mobile viewport to match the previous requirements and testing context
        context = browser.new_context(viewport={'width': 390, 'height': 844})
        page = context.new_page()

        try:
            print("Starting Library Search User Journey...")

            # 1. Navigation and Initial State
            page.goto("http://localhost:4173/")
            expect(page.get_by_role("heading", name="My Library")).to_be_visible()
            print("- Navigated to Library.")

            # 2. Add Content (User Journey: Populating the Library)
            # Check if library is empty or has content, if empty add demo book
            if page.get_by_text("Your library is empty").is_visible():
                print("- Library is empty. Adding Demo Book...")
                page.get_by_text("Load Demo Book (Alice in Wonderland)").click()
                expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible(timeout=10000)
            else:
                 print("- Library already has content.")
                 # Ensure Alice is there for the test
                 if not page.get_by_text("Alice's Adventures in Wonderland").is_visible():
                     # Assuming there might be an add button or we just fail if our test data isn't there.
                     # For this specific journey, we rely on the demo book being available or already loaded.
                     pass

            # 3. Search Functionality (User Journey: Finding a specific book)
            print("- Testing Search Functionality...")
            search_input = page.get_by_placeholder("Search")

            # 3a. Search by Title (Positive)
            print("  - Searching by Title: 'Alice'")
            search_input.fill("Alice")
            expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible()
            # Ensure filtering happened (checking if other elements are hidden is hard without known data,
            # but we can verify the search input state and result presence)

            # 3b. Search by Author (Positive)
            print("  - Searching by Author: 'Lewis Carroll'")
            search_input.fill("Lewis Carroll")
            expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible()

            # 3c. Search (Negative)
            print("  - Searching for non-existent book: 'Space Odysey'")
            search_input.fill("Space Odysey")
            expect(page.get_by_text('No books found matching "Space Odysey"')).to_be_visible()

            # 3d. Clear Search
            print("  - Clearing Search")
            page.get_by_role("button", name="Clear search").click()
            expect(page.get_by_text("Alice's Adventures in Wonderland")).to_be_visible()
            expect(search_input).to_have_value("")

            # 4. Sorting Functionality (User Journey: Organizing the Library)
            print("- Testing Sorting Functionality...")
            # Note: With only one book, sorting doesn't visually change order,
            # but we can verify the controls exist and are interactive.

            sort_select = page.get_by_test_id("sort-select")
            expect(sort_select).to_be_visible()

            # Select 'Title'
            print("  - Sorting by Title")
            sort_select.select_option("title")
            # Verify the value changed
            expect(sort_select).to_have_value("title")

            # Select 'Author'
            print("  - Sorting by Author")
            sort_select.select_option("author")
            expect(sort_select).to_have_value("author")

            print("User Journey Verification Completed Successfully.")

        except Exception as e:
            print(f"Error during verification: {e}")
            raise e
        finally:
            browser.close()

if __name__ == "__main__":
    verify_library_user_journey()
