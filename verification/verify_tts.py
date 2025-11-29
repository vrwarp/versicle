
import time
from playwright.sync_api import sync_playwright, expect

def verify_tts_ui(page):
    # 1. Reset App
    page.goto("http://localhost:5173/")

    # 2. Upload Book
    page.set_input_files("input[type='file']", "verification/alice.epub")
    page.wait_for_selector("[data-testid='book-card']", timeout=10000)
    page.click("[data-testid='book-card']")
    page.wait_for_timeout(5000)

    # 3. Navigate to Chapter I (to get text)
    page.click("[data-testid='reader-toc-button']")
    page.wait_for_selector("[data-testid='reader-toc-sidebar']", timeout=2000)
    # Find "Chapter I" or similar. Alice usually has "I. Down the Rabbit-Hole"
    # We just click the second item or search text.
    page.get_by_text("Down the Rabbit-Hole").click()
    page.wait_for_timeout(3000) # Wait for render and text extraction

    # 4. Open TTS Panel
    page.click("[data-testid='reader-tts-button']")
    page.wait_for_selector("[data-testid='tts-panel']", timeout=2000)

    # 5. Verify Queue is populated
    page.wait_for_selector("[data-testid='tts-queue-list']", timeout=5000)
    expect(page.locator("[data-testid^='tts-queue-item-']")).not_to_have_count(0)

    # 6. Verify Skip Buttons
    expect(page.get_by_test_id("tts-seek-back-button")).to_be_visible()
    expect(page.get_by_test_id("tts-seek-forward-button")).to_be_visible()

    # Take screenshot of Queue and Controls
    page.screenshot(path="verification/verify_tts_queue.png")
    print("Screenshot saved to verification/verify_tts_queue.png")

    # 7. Check Active Highlight (Visual)
    # We can't easily check 'active' class without clicking play, but index 0 is active by default.
    # We can check CSS class of item-0.
    item0 = page.get_by_test_id("tts-queue-item-0")
    # Expect it to have 'bg-primary/20' or similar
    # Playwright check class:
    classes = item0.get_attribute("class")
    print(f"Item 0 classes: {classes}")

    # 8. Open Settings
    page.click("[data-testid='tts-settings-button']")
    page.wait_for_timeout(500)
    page.screenshot(path="verification/verify_tts_settings.png")
    print("Screenshot saved to verification/verify_tts_settings.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        try:
            verify_tts_ui(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()
