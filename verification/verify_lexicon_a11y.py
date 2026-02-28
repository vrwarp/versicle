from playwright.sync_api import sync_playwright, expect

def test_lexicon_accessibility(page):
    # 1. Navigate to the app
    page.goto("https://localhost:5173")

    # 2. Open Settings
    page.get_by_test_id("header-settings-button").click()

    # 3. Switch to Dictionary tab
    page.get_by_role("button", name="Dictionary").click()

    # 4. Open Lexicon Manager
    page.get_by_role("button", name="Manage Rules").click()

    # Wait for dialog
    expect(page.get_by_role("dialog", name="Pronunciation Lexicon")).to_be_visible()

    # 5. Verify ARIA labels on buttons (Add Rule first to ensure we have buttons?)
    # The default view might be empty "No rules defined".
    # I should add a rule to see the Move/Edit/Delete buttons.

    page.get_by_test_id("lexicon-add-rule-btn").click()

    # Verify Save/Cancel ARIA labels
    expect(page.get_by_label("Save rule")).to_be_visible()
    expect(page.get_by_label("Cancel adding")).to_be_visible()

    # Add a dummy rule to verify Move/Delete buttons
    page.get_by_test_id("lexicon-input-original").fill("test")
    page.get_by_test_id("lexicon-input-replacement").fill("pass")
    page.get_by_label("Save rule").click()

    # Now verify the list item buttons
    expect(page.get_by_label("Move rule up")).to_be_visible()
    expect(page.get_by_label("Move rule down")).to_be_visible()
    expect(page.get_by_label("Delete rule")).to_be_visible()

    # Also check the tabs
    expect(page.get_by_role("tab", name="Global")).to_be_visible()

    # 6. Screenshot
    page.screenshot(path="verification/lexicon_manager.png")
    print("Verification screenshot saved to verification/lexicon_manager.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_lexicon_accessibility(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
            raise
        finally:
            browser.close()
