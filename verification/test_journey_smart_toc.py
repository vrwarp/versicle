
import os
import time
import json
from playwright.sync_api import sync_playwright, expect
from utils import ensure_library_with_book, reset_app

def test_journey_smart_toc(page):
    # 1. Reset and Load
    reset_app(page)
    ensure_library_with_book(page)

    # 2. Inject Mock Data for GenAI
    # We use real IDs from Alice in Wonderland (np-4 is Chapter 1)
    mock_response = [
        {"id": "np-4", "title": "AI Generated: The Rabbit Hole"},
        {"id": "np-5", "title": "AI Generated: Pool of Tears"}
    ]

    page.evaluate(f"""() => {{
        localStorage.setItem('genai-storage', JSON.stringify({{ state: {{ isEnabled: true, apiKey: 'mock-key', model: 'gemini-2.5-flash-lite' }}, version: 0 }}));
        localStorage.setItem('mockGenAIResponse', '{json.dumps(mock_response)}');
    }}""")

    # Reload to pick up store changes
    page.reload()

    # 3. Open Reader
    page.locator('[data-testid^="book-card-"]').first.click()
    expect(page.get_by_test_id("reader-view")).to_be_visible(timeout=20000)

    # 4. Open TOC
    page.get_by_test_id("reader-toc-button").click()
    expect(page.get_by_test_id("reader-toc-sidebar")).to_be_visible()

    # 5. Enable Generated Titles
    # Before enabling, check original title exists
    expect(page.get_by_text("CHAPTER I. Down the Rabbit-Hole")).to_be_visible()

    page.get_by_label("Generated Titles").click()

    # 6. Click Enhance
    enhance_btn = page.get_by_role("button", name="Enhance Titles with AI")
    expect(enhance_btn).to_be_visible()
    enhance_btn.click()

    # 7. Wait for Success Toast
    expect(page.get_by_text("Table of Contents enhanced successfully!")).to_be_visible(timeout=10000)

    # 8. Verify Titles Updated
    # Check that the new titles are visible
    expect(page.get_by_text("AI Generated: The Rabbit Hole")).to_be_visible()
    expect(page.get_by_text("AI Generated: Pool of Tears")).to_be_visible()

    # Verify original title is GONE (or at least replaced in the list view)
    # Note: text content match might still find it if it's in the DOM but hidden?
    # But in the list, it should be replaced.
    expect(page.get_by_text("CHAPTER I. Down the Rabbit-Hole")).not_to_be_visible()

    os.makedirs("verification/screenshots", exist_ok=True)
    page.screenshot(path="verification/screenshots/smart_toc_success.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        try:
            test_journey_smart_toc(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error_smart_toc_success.png")
            raise # Ensure CI fails if test fails
        finally:
            browser.close()
