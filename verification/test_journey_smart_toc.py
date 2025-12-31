import os
import time
import json
import pytest
from playwright.sync_api import sync_playwright, expect
from verification.utils import ensure_library_with_book, reset_app, capture_screenshot

def test_smart_toc_success(page):
    print("Starting Smart TOC Success Journey...")
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

    # Wait for library to load
    expect(page.get_by_test_id("library-view")).to_be_visible(timeout=10000)

    # 3. Open Reader
    # Ensure book is present (reload might have cleared state or DB latency)
    try:
        page.locator('[data-testid^="book-card-"]').first.wait_for(timeout=10000)
    except:
        print("Book card missing after reload in Success Scenario, ensuring library again...")
        ensure_library_with_book(page)
        page.locator('[data-testid^="book-card-"]').first.wait_for(timeout=30000)

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
    expect(page.get_by_text("CHAPTER I. Down the Rabbit-Hole")).not_to_be_visible()

    os.makedirs("verification/screenshots", exist_ok=True)
    page.screenshot(path="verification/screenshots/smart_toc_success.png")

def test_smart_toc_failure(page):
    print("Starting Smart TOC Failure Journey...")
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

    # Ensure book is present (reload might have cleared state or DB latency)
    try:
        page.locator('[data-testid^="book-card-"]').first.wait_for(timeout=10000)
    except:
        print("Book card missing after reload, ensuring library again...")
        ensure_library_with_book(page)
        page.locator('[data-testid^="book-card-"]').first.wait_for(timeout=30000)

    page.locator('[data-testid^="book-card-"]').first.click()
    expect(page.get_by_test_id("reader-view")).to_be_visible(timeout=20000)

    page.get_by_test_id("reader-toc-button").click()
    expect(page.get_by_test_id("reader-toc-sidebar")).to_be_visible()
    page.get_by_label("Generated Titles").click()

    page.get_by_role("button", name="Enhance Titles with AI").click()

    # Expect error toast
    try:
        # Increased timeout to rule out performance issues
        expect(page.get_by_text("AI features are disabled or not configured")).to_be_visible(timeout=10000)
    except AssertionError:
        print("Taking failure screenshot for Scenario 1...")
        os.makedirs("verification/screenshots", exist_ok=True)
        page.screenshot(path="verification/screenshots/smart_toc_failure_sc1.png")
        raise

    # 2. Service Failure Scenario
    print("--- Scenario 2: Service Failure ---")
    # Reset history state to ensure sidebar is closed after reload
    page.evaluate("history.replaceState(null, '')")
    page.evaluate("""() => {
        localStorage.setItem('genai-storage', JSON.stringify({ state: { isEnabled: true, apiKey: 'mock-key', model: 'gemini-2.5-flash-lite' }, version: 0 }));
        localStorage.setItem('mockGenAIError', 'true');
    }""")
    page.reload()

    # Ensure in reader
    try:
        expect(page.get_by_test_id("reader-view")).to_be_visible(timeout=5000)
    except:
        page.locator('[data-testid^="book-card-"]').first.wait_for(timeout=30000)
        page.locator('[data-testid^="book-card-"]').first.click()
        expect(page.get_by_test_id("reader-view")).to_be_visible(timeout=20000)

    page.get_by_test_id("reader-toc-button").click()
    expect(page.get_by_test_id("reader-toc-sidebar")).to_be_visible()
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
