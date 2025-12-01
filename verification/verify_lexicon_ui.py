from playwright.sync_api import Page, expect, sync_playwright

def verify_lexicon_ui(page: Page):
    print("Verifying Lexicon UI...")

    # Go to home
    page.goto("http://localhost:5173", timeout=10000)

    # Load demo book if not present
    if page.get_by_text("Load Demo Book").is_visible():
        page.get_by_text("Load Demo Book").click()
        page.get_by_text("Alice's Adventures in Wonderland").wait_for(state="visible", timeout=15000)

    # Open book
    # Increase timeout for finding the book card
    page.get_by_text("Lewis Carroll").click(timeout=10000)
    page.get_by_test_id("reader-next-page").wait_for(state="visible", timeout=15000)

    # Open Audio Panel
    page.get_by_test_id("reader-tts-button").click()

    # Open Settings
    page.get_by_role("button", name="Settings").click()

    # Open Lexicon
    page.get_by_role("button", name="Manage Pronunciation Rules").click()

    # Verify Heading
    expect(page.get_by_role("heading", name="Pronunciation Lexicon")).to_be_visible(timeout=5000)

    # Wait a bit for layout
    page.wait_for_timeout(1000)

    # Take screenshot of the Lexicon Manager with Import/Export buttons
    screenshot_path = "/home/jules/verification/lexicon_ui.png"
    page.screenshot(path=screenshot_path)
    print(f"Screenshot saved to {screenshot_path}")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            verify_lexicon_ui(page)
        finally:
            browser.close()
