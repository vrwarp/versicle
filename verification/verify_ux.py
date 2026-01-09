import time
from playwright.sync_api import sync_playwright

def run():
    print("Starting Playwright...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        print("Navigating to app...")
        try:
            page.goto("http://localhost:5173")
        except Exception as e:
             print(f"Could not connect to localhost:5173: {e}")
             browser.close()
             return

        print("Waiting for Library view...")
        try:
            page.wait_for_selector('text=My Library', timeout=10000)
        except Exception as e:
             print(f"Library view did not load: {e}")
             page.screenshot(path="verification/error_library.png")
             browser.close()
             return

        print("Opening book...")
        book_card = page.locator("[data-testid^='book-card-']").first
        if book_card.count() > 0:
            book_card.click()
        else:
            print("No books found.")
            # Create a dummy book or fail
            page.screenshot(path="verification/no_books.png")
            browser.close()
            return

        print("Waiting for Reader view...")
        try:
             page.wait_for_selector('[data-testid="reader-view"]', timeout=20000)
        except Exception as e:
             print(f"Reader view not found: {e}")
             page.screenshot(path="verification/error_reader.png")
             browser.close()
             return

        print("Selecting text...")
        # Give epub.js time to render
        time.sleep(3)

        frame_element = page.locator('iframe').first
        try:
            frame_element.wait_for(state="visible", timeout=10000)
            frame = frame_element.content_frame
            if not frame:
                print("No content frame found")
                browser.close()
                return

            frame.wait_for_selector('p', timeout=10000)
            p_handle = frame.locator('p').first
            box = p_handle.bounding_box()

            if box:
                print(f"Selecting text at {box}")
                # We need to ensure we select enough text
                page.mouse.move(box['x'] + 20, box['y'] + 20)
                page.mouse.down()
                page.mouse.move(box['x'] + 200, box['y'] + 20)
                page.mouse.up()

                print("Waiting for annotation pill...")
                try:
                    page.wait_for_selector('[data-testid="compass-pill-annotation"]', timeout=5000)
                except:
                     print("Annotation pill did not appear.")
                     page.screenshot(path="verification/error_no_pill.png")
                     browser.close()
                     return

                print("Clicking copy...")
                page.click('[data-testid="popover-copy-button"]')

                # Small delay for React state update
                time.sleep(0.1)

                page.screenshot(path="verification/copy_feedback.png")
                print("Screenshot taken: verification/copy_feedback.png")
            else:
                print("Could not find text bounding box")
        except Exception as e:
            print(f"Error interacting with iframe: {e}")
            page.screenshot(path="verification/error_iframe.png")

        browser.close()

if __name__ == "__main__":
    run()
