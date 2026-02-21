from playwright.sync_api import sync_playwright

def test_ambiguity():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Simulate the DOM state where both buttons exist
        page.set_content("""
            <html>
                <body>
                    <!-- Existing button in empty state -->
                    <button>Clear search</button>

                    <!-- My new button with the problematic label -->
                    <button aria-label="Clear search input">X</button>
                </body>
            </html>
        """)

        try:
            print("Attempting to click 'Clear search' with collision...")
            # This mimics the failing test
            page.get_by_role("button", name="Clear search").click(timeout=2000)
            print("Clicked successfully (Unexpected)")
        except Exception as e:
            print(f"Caught expected error: {e}")

        # Now test the proposed fix
        page.set_content("""
            <html>
                <body>
                    <!-- Existing button in empty state -->
                    <button>Clear search</button>

                    <!-- My new button with the FIXED label -->
                    <button aria-label="Clear query">X</button>
                </body>
            </html>
        """)

        try:
            print("\nAttempting to click 'Clear search' with fix...")
            page.get_by_role("button", name="Clear search").click(timeout=2000)
            print("Clicked successfully (Expected)")
        except Exception as e:
            print(f"Caught unexpected error: {e}")

        browser.close()

if __name__ == "__main__":
    test_ambiguity()
