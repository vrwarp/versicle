from playwright.sync_api import sync_playwright, expect
import os

def run():
    print("Starting verification script...")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        print("Navigating to app...")
        try:
            page.goto("http://localhost:5173", timeout=30000)
        except Exception as e:
            print(f"Failed to load page: {e}")
            return

        print(f"Page title: {page.title()}")

        print("Waiting for library view...")
        try:
            # expect(page.get_by_testid("library-view")).to_be_visible(timeout=10000)
            expect(page.get_by_text("My Library")).to_be_visible(timeout=10000)
        except:
            if page.get_by_text("Something went wrong").count() > 0:
                 print("ErrorBoundary hit!")
                 try:
                     print("Error details:")
                     print(page.locator("pre").first.text_content())
                 except:
                     print("Could not get error details.")
            elif page.get_by_text("Initializing...").count() > 0:
                print("Stuck on Initializing... DB might be hanging.")
            else:
                print("Library view not found and not initializing.")
                try:
                    print("Body text:", page.locator("body").text_content())
                except:
                    print("Could not get body text.")
            return

        # Check if book already exists
        book_locator = page.get_by_text("Alice's Adventures in Wonderland")

        # Wait a bit for books to load
        page.wait_for_timeout(2000)

        if book_locator.count() == 0:
            print("Book not found. Checking for Empty Library...")
            if page.get_by_text("Your library is empty").count() > 0:
                print("Empty library found. Clicking Load Demo Book...")
                page.get_by_text("Load Demo Book").click()

                # Check for loading state
                try:
                    expect(page.get_by_text("Loading...")).to_be_visible(timeout=5000)
                    print("Import started...")
                except:
                    print("Loading text not seen.")

                print("Waiting for book to appear (60s timeout)...")
                try:
                    expect(book_locator).to_be_visible(timeout=60000)
                except:
                    print("Book did not appear.")
                    return
            else:
                 print("Library not empty but book not found? Maybe list view?")
                 pass
        else:
            print("Book found.")

        print("Opening book...")
        book_locator.first.click()

        print("Waiting for reader view...")
        # expect(page.get_by_testid("reader-view")).to_be_visible(timeout=10000)
        # Use a text check instead if testid is flaky
        expect(page.get_by_label("Visual Settings")).to_be_visible(timeout=10000)

        print("Opening Visual Settings...")
        page.get_by_label("Visual Settings").click()

        print("Verifying ARIA labels in Visual Settings...")

        # Font size slider
        slider = page.get_by_label("Font size percentage")
        expect(slider).to_be_visible()
        print("Found Font Size Slider")

        # Line height buttons
        minus_btn = page.get_by_label("Decrease line height")
        plus_btn = page.get_by_label("Increase line height")
        expect(minus_btn).to_be_visible()
        expect(plus_btn).to_be_visible()
        print("Found Line Height Buttons")

        print("Taking screenshot of Visual Settings...")
        page.screenshot(path="verification/verification.png")

        # Close Settings
        page.get_by_role("button", name="Close").click()

        print("Opening Search...")
        page.get_by_label("Search").click()

        print("Verifying ARIA labels in Search...")
        expect(page.get_by_label("Search query")).to_be_visible()
        print("Found Search Query Input")
        expect(page.get_by_label("Close search")).to_be_visible()
        print("Found Close Search Button")

        print("Verification complete.")
        browser.close()

if __name__ == "__main__":
    run()
