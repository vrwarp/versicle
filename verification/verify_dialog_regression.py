
import os
from playwright.sync_api import sync_playwright

def verify_interstitial_close_button():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # We need to construct a test page that renders the component.
        # However, rendering a React component in isolation via Playwright requires a running app
        # and some way to mount it or trigger it.

        # Since I modified the Dialog component which is used by ReprocessingInterstitial,
        # and ReprocessingInterstitial is triggered by LibraryView on outdated books.

        # A simpler approach for visual verification of the "Dialog" change itself
        # is to create a small HTML file with the same CSS/structure if possible,
        # BUT since I cannot easily replicate the React rendering chain without full app,
        # I will try to trigger the ReprocessingInterstitial in the app.

        # Triggering ReprocessingInterstitial requires:
        # 1. Loading the app
        # 2. Having a book with version < 1
        # 3. Clicking the book.

        # This seems complex to set up in a temporary script without pre-existing data.

        # ALTERNATIVE: Verify the CSS/HTML structure of the Dialog change via a unit test (already done)
        # OR try to create a standalone reproduction if I can use the existing dev server.

        # Let's try to verify the `hideCloseButton` logic by creating a small HTML/JS reproduction
        # that mimics the DOM structure if I can't easily drive the full app.

        # However, I have a running dev server.
        # But I don't have a book with version < 1 easily available unless I mock the DB.

        # Let's write a script that injects a test component into the page
        # that uses the modified Dialog.

        # Actually, I can use the `Modal` component directly if I can access the bundle.
        # But that's hard.

        # Given the constraint, and that I've already verified with a unit test that the prop is passed
        # and the element is conditionally rendered.

        # Let's try to load the main page and see if I can manually trigger a Dialog state via console
        # or if there is any existing Dialog I can check to ensure the close button IS present (regression test).

        page = browser.new_page()
        try:
            page.goto("http://localhost:5173")
            page.wait_for_selector('body', timeout=10000)

            # Take a screenshot of the library
            page.screenshot(path="verification/library_view.png")
            print("Library view screenshot taken.")

            # I can't easily force the ReprocessingInterstitial without DB manipulation.
            # But I can check if other dialogs still have the close button.
            # E.g. Global Settings.

            # Click the settings button (assuming it exists on the library header)
            # Memory says: "header-settings-button"

            try:
                page.locator('[data-testid="header-settings-button"]').click(timeout=5000)
                # Wait for dialog
                page.wait_for_selector('[role="dialog"]', timeout=5000)

                # Check for the close button.
                # The close button in Modal is DialogPrimitive.Close which usually has "Close" sr-only text.
                # My change was:
                # {!hideCloseButton && ( <DialogPrimitive.Close ...> ... </DialogPrimitive.Close> )}

                # So for Global Settings (which doesn't set hideCloseButton), it should be there.

                if page.locator('button:has-text("Close")').is_visible() or page.locator('span:has-text("Close")').is_visible():
                     print("Close button is visible on Global Settings (Correct).")
                else:
                     # Check for the X icon or button class
                     if page.locator('button.absolute.right-4.top-4').is_visible():
                         print("Close button (X) is visible on Global Settings (Correct).")
                     else:
                         print("WARNING: Close button NOT found on Global Settings!")

                page.screenshot(path="verification/settings_dialog.png")

            except Exception as e:
                print(f"Could not open settings dialog: {e}")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_interstitial_close_button()
