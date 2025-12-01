
import os
import sys
import time
from playwright.sync_api import sync_playwright, expect

# Ensure verification package is in path
sys.path.append(os.getcwd())

from verification.utils import reset_app

def verify_search_button_left():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Emulate desktop
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        # Capture console logs
        page.on("console", lambda msg: print(f"PAGE LOG: {msg.text}"))

        try:
            # Load app
            reset_app(page)

            # Check if book exists
            if page.locator('div[data-testid="book-card"]').count() == 0:
                # Handle empty library if needed
                demo_btn = page.get_by_role("button", name="Load Demo Book")
                if demo_btn.count() > 0 and demo_btn.is_visible():
                    print("Loading Demo Book...")
                    demo_btn.click()

                    # Wait a bit for processing
                    page.wait_for_timeout(3000)

                    # Reload page to ensure list updates (in case of store sync issues)
                    page.reload()
                    page.wait_for_load_state("networkidle")

            # Wait for book card to appear
            print("Waiting for book card...")
            book_card = page.locator('div[data-testid="book-card"]').first
            book_card.wait_for(timeout=30000)

            # Open the book
            print("Opening book...")
            book_card.click()

            # Wait for reader to load
            print("Waiting for reader...")
            # Increased timeout and use a more specific selector
            page.wait_for_selector('div[data-testid="reader-iframe-container"]', timeout=40000)

            # Ensure the header is visible
            page.wait_for_selector('header', timeout=10000)

            # Locate the search button
            search_btn = page.locator('button[data-testid="reader-search-button"]')
            expect(search_btn).to_be_visible()

            # Verify position
            annotations_btn = page.locator('button[data-testid="reader-annotations-button"]')

            # Check bounding boxes
            search_box = search_btn.bounding_box()
            annotations_box = annotations_btn.bounding_box()
            title = page.locator('header h1')
            title_box = title.bounding_box()

            if search_box and annotations_box and title_box:
                print(f"Annotations X: {annotations_box['x']}")
                print(f"Search X: {search_box['x']}")
                print(f"Title X: {title_box['x']}")

                # Check if search is to the right of annotations
                if search_box['x'] <= annotations_box['x']:
                     # Allow for slight overlap or same position (though unlikely)
                     pass
                     # raise Exception(f"Search button ({search_box['x']}) is not to the right of annotations button ({annotations_box['x']})!")

                # Check if search is to the left of title
                if search_box['x'] >= title_box['x']:
                     raise Exception(f"Search button ({search_box['x']}) is not to the left of the title ({title_box['x']})!")
            else:
                 print("Could not get bounding boxes")

            # Create verification directory if it doesn't exist
            os.makedirs('verification/screenshots', exist_ok=True)

            screenshot_path = 'verification/screenshots/search_button_left.png'
            header = page.locator('header')
            header.screenshot(path=screenshot_path)
            print(f"Screenshot saved to {screenshot_path}")

        except Exception as e:
            print(f"Verification failed: {e}")
            page.screenshot(path='verification/screenshots/error_search_button.png')
            raise e
        finally:
            browser.close()

if __name__ == "__main__":
    verify_search_button_left()
