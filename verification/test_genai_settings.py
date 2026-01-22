import pytest
from playwright.sync_api import Page, expect

def test_genai_settings_tab(page: Page):
    # 1. Open App
    page.goto("http://localhost:5173")

    # 2. Wait for Load
    page.wait_for_timeout(5000)

    # 3. Open Settings
    # Try to find the settings button. It might be an icon.
    # Usually accessible by label "Settings".
    page.get_by_label("Settings").first.click()

    # 4. Check for "Generative AI" tab
    genai_tab = page.get_by_role("button", name="Generative AI")
    expect(genai_tab).to_be_visible()

    # 5. Click tab
    genai_tab.click()

    # 6. Check for content
    expect(page.get_by_text("Generative AI Configuration")).to_be_visible()
    expect(page.get_by_label("Enable AI Features")).to_be_visible()

    # 7. Take screenshot
    page.screenshot(path="verification/screenshots/genai_settings.png")
