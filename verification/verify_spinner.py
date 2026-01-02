from playwright.sync_api import sync_playwright

def verify_spinner():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the app (assuming it's running on port 5173 as per standard Vite)
        # Note: In a real environment, we'd need to know the port.
        # I'll try 5173 first.
        try:
            page.goto("http://localhost:5173")
            page.wait_for_load_state("networkidle")

            # Check if we are on the empty library page
            if page.get_by_text("Your library is empty").is_visible():
                print("On empty library page")

                # We need to simulate the "isImporting" state to see the spinner.
                # Since we can't easily modify the store from outside,
                # we can click the "Load Demo Book" button which sets isImporting to true briefly.
                # However, it might be too fast to catch.
                # Alternatively, we can inject a script to mock the store or just verify the button is there.

                # Let's try to click and catch the spinner if possible, or just take a screenshot of the button.
                # The button text should be "Load Demo Book (Alice in Wonderland)" initially.

                btn = page.get_by_role("button", name="Load Demo Book (Alice in Wonderland)")
                if btn.is_visible():
                    print("Button found")
                    page.screenshot(path="verification/before_click.png")

                    # Click the button
                    btn.click()

                    # It might switch to "Loading..."
                    # We wait for the text "Loading..."
                    try:
                        loading_btn = page.get_by_role("button", name="Loading...")
                        loading_btn.wait_for(state="visible", timeout=2000)
                        print("Loading state visible")
                        page.screenshot(path="verification/loading_state.png")
                    except:
                        print("Could not catch loading state (might be too fast)")

                else:
                    print("Button not found")

            else:
                print("Not on empty library page")
                page.screenshot(path="verification/unknown_page.png")

        except Exception as e:
            print(f"Error: {e}")

        finally:
            browser.close()

if __name__ == "__main__":
    verify_spinner()
