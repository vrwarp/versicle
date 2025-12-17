
import os
import time
from playwright.sync_api import sync_playwright, expect
from verification.utils import ensure_library_with_book, reset_app
from verification.utils import capture_screenshot

def test_journey_smart_toc_failure(page):
    page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))

    # Setup
    reset_app(page)
    ensure_library_with_book(page)

    # 1. Missing Key Scenario
    print("--- Scenario 1: Missing Key ---")
    page.evaluate("""() => {
        localStorage.setItem('genai-storage', JSON.stringify({ state: { isEnabled: true, apiKey: '', model: 'gemini-2.5-flash-lite' }, version: 0 }));
        localStorage.removeItem('mockGenAIResponse');
        localStorage.removeItem('mockGenAIError');
    }""")
    page.reload()

    page.locator('[data-testid^="book-card-"]').first.click()
    expect(page.get_by_test_id("reader-view")).to_be_visible()

    page.get_by_test_id("reader-toc-button").click()
    page.get_by_label("Generated Titles").click()

    page.get_by_role("button", name="Enhance Titles with AI").click()

    # Expect error toast
    expect(page.get_by_text("AI features are disabled or not configured")).to_be_visible()

    # 2. Service Failure Scenario
    print("--- Scenario 2: Service Failure ---")
    page.evaluate("""() => {
        localStorage.setItem('genai-storage', JSON.stringify({ state: { isEnabled: true, apiKey: 'mock-key', model: 'gemini-2.5-flash-lite' }, version: 0 }));
        localStorage.setItem('mockGenAIError', 'true');
    }""")
    page.reload()

    # Ensure in reader
    try:
        expect(page.get_by_test_id("reader-view")).to_be_visible(timeout=5000)
    except:
        page.locator('[data-testid^="book-card-"]').first.click()
        expect(page.get_by_test_id("reader-view")).to_be_visible()

    page.get_by_test_id("reader-toc-button").click()
    page.get_by_label("Generated Titles").click()

    page.get_by_role("button", name="Enhance Titles with AI").click()

    # Check for success toast (false positive)
    if page.get_by_text("Table of Contents enhanced successfully!").is_visible():
        print("FAILURE: Got success toast instead of error! Chapters likely empty.")

    # Expect failure toast
    try:
        expect(page.get_by_text("Failed to enhance TOC")).to_be_visible(timeout=5000)
    except AssertionError:
        print("Taking failure screenshot...")
        os.makedirs("verification/screenshots", exist_ok=True)
        page.screenshot(path="verification/screenshots/smart_toc_failure_debug.png")
        raise

    os.makedirs("verification/screenshots", exist_ok=True)
    page.screenshot(path="verification/screenshots/smart_toc_failure.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        try:
            test_journey_smart_toc_failure(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error_smart_toc_failure.png")
        finally:
            browser.close()
