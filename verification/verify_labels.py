from playwright.sync_api import sync_playwright, expect

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            # 1. Open App
            print("Navigating...")
            page.goto("http://localhost:5173")

            # Wait for content
            page.wait_for_timeout(2000)

            # 2. Open Settings
            print("Clicking settings...")
            page.click('[data-testid="header-settings-button"]', timeout=5000)

            # 3. Go to Sync tab
            print("Clicking Sync tab...")
            page.click('text="Sync & Cloud"')

            # 4. Enable Firebase (if not already)
            # Find the Select trigger for Sync Provider.
            # It's the first select in this tab? Or we can look for "Select sync provider" or the current value.
            # The label is "Sync Provider".

            print("Selecting Firebase...")
            # We can use the text "Disabled" if it's the current value, or look for the select trigger near "Sync Provider"
            # Since I didn't add an ID to the Sync Provider Select Trigger, I have to find it by proximity or order.

            # Assuming it's currently "Disabled" or "None"
            # Let's try to find the select trigger.
            # It is inside a div with label "Sync Provider".

            # This locator finds the trigger inside the div that has the label
            page.click('text="Sync Provider" >> .. >> [role="combobox"]')

            # Now click the option "Firebase (Recommended)"
            page.click('role=option[name="Firebase (Recommended)"]')

            # 5. Verify Label Association
            # Now inputs should be visible.
            print("Clicking label 'API Key'...")
            label = page.locator('label[for="firebase-api-key"]')
            label.click()

            # 6. Check if input is focused
            print("Checking focus...")
            input_field = page.locator('#firebase-api-key')
            expect(input_field).to_be_focused()

            print("Success: Clicking label focused the input!")

            # 7. Screenshot
            page.screenshot(path="verification/verification.png")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")

        finally:
            browser.close()

if __name__ == "__main__":
    run()
