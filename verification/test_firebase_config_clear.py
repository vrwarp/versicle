import pytest
from playwright.sync_api import Page, expect

def test_firebase_config_clear(page: Page):
    """
    Verifies that the Firebase configuration can be cleared from the UI.

    1. Open Settings -> Sync & Cloud.
    2. Select 'Firebase' provider.
    3. Enter dummy configuration.
    4. Verify 'Sign In' state appears (config accepted).
    5. Click 'Clear Configuration'.
    6. Verify configuration form reappears.
    """
    # Navigate to app
    page.goto("http://localhost:5173")

    # Open Global Settings
    page.get_by_test_id("header-settings-button").click()

    # Go to Sync tab
    page.get_by_role("button", name="Sync & Cloud").click()

    # Select Firebase provider
    # The select trigger shows the current value (likely Disabled or Select sync provider)
    # We find it by looking for the select in the Sync Provider section
    # Based on code: <SelectTrigger><SelectValue placeholder="Select sync provider" /></SelectTrigger>
    # It might be easier to use the label to find the select
    # page.get_by_label("Sync Provider").click() # Not sure if label is associated correctly

    # Let's try to find the select by the text in it, which defaults to "Disabled" (value="none")
    page.get_by_role("combobox").first.click()
    page.get_by_role("option", name="Firebase (Recommended)").click()

    # Verify Firebase Config section appears
    expect(page.get_by_role("heading", name="Firebase Configuration")).to_be_visible()

    # Enter dummy config
    dummy_config = """
const firebaseConfig = {
  apiKey: "dummy-api-key",
  authDomain: "dummy.firebaseapp.com",
  projectId: "dummy-project",
  appId: "dummy-app-id"
};
"""
    # Find the textarea
    page.get_by_placeholder("// Paste your Firebase config here").fill(dummy_config)

    # Wait for isConfigured to trigger (useEffect or render update)
    # The UI should switch to "Sign In" state
    expect(page.get_by_text("Sign in with Google")).to_be_visible()

    # Now look for "Clear Configuration" button
    # This step is expected to fail initially
    clear_btn = page.get_by_role("button", name="Clear Configuration")
    expect(clear_btn).to_be_visible()

    # Take screenshot of the Sign In state with Clear button
    page.screenshot(path="verification/firebase_signin_state_with_clear_btn.png")

    # Handle confirmation dialog
    page.on("dialog", lambda dialog: dialog.accept())

    clear_btn.click()

    # Verify we are back to the form
    expect(page.get_by_placeholder("// Paste your Firebase config here")).to_be_visible()

    # Verify fields are empty (or at least the form is visible)
    # The textarea might be controlled or uncontrolled, but if we see it, we are good.
    # We can check if apiKey input is empty
    expect(page.locator("input[type='password']").first).to_have_value("")
