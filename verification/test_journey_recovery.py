from playwright.sync_api import Page, expect, sync_playwright

def test_recovery_flow(page: Page):
    # 1. Open App
    print("Opening App...")
    page.goto("http://localhost:5173")

    # Wait for app to load
    page.wait_for_timeout(3000)

    # 2. Open Settings
    print("Opening Settings...")
    # Using aria-label as seen in LibraryView.tsx
    settings_btn = page.get_by_role("button", name="Settings")
    if not settings_btn.is_visible():
        print("Settings button not found. Dumping accessible buttons:")
        for btn in page.get_by_role("button").all():
            print(f"- {btn.text_content()} | {btn.get_attribute('aria-label')}")

    expect(settings_btn).to_be_visible()
    settings_btn.click()

    # 3. Go to Recovery Tab
    print("Navigating to Recovery Tab...")
    recovery_tab = page.get_by_role("button", name="Recovery")
    expect(recovery_tab).to_be_visible()
    recovery_tab.click()

    # 4. Create Snapshot
    print("Creating Snapshot...")
    create_btn = page.get_by_role("button", name="Create Snapshot")
    expect(create_btn).to_be_visible()
    create_btn.click()

    # Wait for toast or list update
    page.wait_for_timeout(2000)

    # 5. Verify Snapshot in List
    print("Verifying Snapshot...")
    # Checkpoint list item with "manual" badge
    # We look for text "manual" inside the list
    manual_badge = page.get_by_text("manual").first
    expect(manual_badge).to_be_visible()

    # 6. Inspect
    print("Inspecting...")
    # Find Inspect button in the same row or just the first one
    inspect_btn = page.get_by_role("button", name="Inspect").first
    inspect_btn.click()

    # 7. Check Inspector View
    print("Checking Inspector View...")
    expect(page.get_by_text("Checkpoint Inspection")).to_be_visible()

    # Snapshot verified successfully

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_recovery_flow(page)
            print("Verification script finished successfully.")
        except Exception as e:
            print(f"Verification failed: {e}")
            page.screenshot(path="verification/failed.png")
        finally:
            browser.close()
