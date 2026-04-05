import time
import pytest
from playwright.sync_api import Page, expect

def test_journey_workspace_switch(page: Page):
    """
    Journey: Workspace Context Switch
    
    1. Device A: Start on default workspace.
    2. Device A: Create new workspace `reading-group`.
    3. Device A: Switch to `reading-group` (triggers multi-stage commit).
    4. Post-reload: Verify confirmation modal appears.
    5. Confirm switch -> verify active workspace is now `reading-group`.
    """
    # Navigate to app
    page.add_init_script("window.__VERSICLE_MOCK_FIRESTORE__ = true;")
    page.goto("http://localhost:5173")

    # Bypass the intro dialog if it appears
    try:
        page.get_by_role("button", name="Continue").click(timeout=2000)
    except Exception:
        pass

    # Open Global Settings
    page.get_by_test_id("header-settings-button").click()

    # Go to Sync tab
    page.get_by_role("button", name="Sync & Cloud").click()

    # Create dummy Firebase configuration to enable sync
    dummy_config = """
const firebaseConfig = {
  apiKey: "dummy-api-key",
  authDomain: "dummy.firebaseapp.com",
  projectId: "dummy-project",
  appId: "dummy-app-id"
};
"""
    page.get_by_placeholder("// Paste your Firebase config here").fill(dummy_config)
    
    # Wait for the workspaces block to appear, which is unlocked after auth completes

    
    # Wait for the workspaces block to appear, which is unlocked after signIn
    expect(page.get_by_role("heading", name="Workspaces")).to_be_visible()
    
    # Active workspace should be default
    expect(page.get_by_text("Active: Default")).to_be_visible()
    
    # Let's create a new workspace
    page.get_by_placeholder("New Workspace Name").fill("Reading Group")
    page.get_by_role("button", name="Create", exact=True).click()
    
    # Wait for creation to finish. It automatically switches without a modal (since it's empty)
    # the name Reading Group will be visible in the list (and as the active workspace)
    expect(page.get_by_text("Reading Group", exact=True).first).to_be_visible()
    
    # NOW let's test the actual multi-stage switch by switching BACK to the default workspace.
    # The list should contain the default workspace (e.g., main4) with a Switch button.
    page.get_by_role("button", name="Switch").first.click()
    
    # This should trigger the confirmation modal! (Wait up to 20s because empty workspaces rely on an 8s timeout before reloading)
    expect(page.get_by_role("heading", name="Finalize Workspace Switch?")).to_be_visible(timeout=20000)
    
    # The modal warns that local data will be synced
    page.get_by_role("button", name="Yes, Finalize").click()
    
    # Now it should close the modal and resume sync
    expect(page.get_by_role("heading", name="Finalize Workspace Switch?")).not_to_be_visible()
    
    # Re-open Settings to verify the active workspace changed back
    page.get_by_test_id("header-settings-button").click()
    page.get_by_role("button", name="Sync & Cloud").click()
    
    # The library should now be connected back to the default workspace
    expect(page.get_by_text("Active: Default")).to_be_visible()
