import pytest
from playwright.sync_api import Page, expect
from verification import utils
import time
import base64

def upload_book(page: Page, filename: str):
    """Utility to upload a book from the verification directory."""
    print(f"Uploading {filename}...")
    with open(f"verification/{filename}", "rb") as f:
        file_bytes = f.read()
    file_base64 = base64.b64encode(file_bytes).decode('utf-8')

    page.evaluate("""({base64Data, filename}) => {
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const file = new File([byteArray], filename, { type: 'application/epub+zip' });

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        const dropEvent = new DragEvent('drop', { dataTransfer: dataTransfer, bubbles: true });
        document.querySelector('[data-testid="library-view"]').dispatchEvent(dropEvent);
    }""", {"base64Data": file_base64, "filename": filename})
    # Small wait for ingestion to start
    page.wait_for_timeout(2000)

def test_language_scoped_font_profiles(page: Page):
    """
    Verifies that changing the font size for a Chinese book doesn't affect an English book,
    and that settings are persisted correctly per language.
    """
    print("Starting Font Profiles Test...")
    utils.reset_app(page)
    
    # 1. Upload English and Chinese Books
    upload_book(page, "alice.epub")
    upload_book(page, "test_chinese.epub")
    
    # Wait for both cards to appear
    en_book = page.locator("[data-testid^='book-card-']", has_text="Alice's Adventures in Wonderland").first
    zh_book = page.locator("[data-testid^='book-card-']", has_text="Test Chinese Book").first
    
    expect(en_book).to_be_visible(timeout=30000)
    expect(zh_book).to_be_visible(timeout=30000)
    
    # 2. Open English Book and set size to 80%
    print("--- Phase 1: Setting English Profile ---")
    en_book.click()
    page.wait_for_selector("iframe")
    
    page.get_by_test_id("reader-visual-settings-button").click()
    page.wait_for_selector("[role='status']:has-text('%')")
    
    # Decrease to 80%
    while "80%" not in page.text_content("[role='status']:has-text('%')"):
        page.click("button[aria-label='Decrease font size']")
        page.wait_for_timeout(100)
        
    utils.capture_screenshot(page, "font_profile_1_en_set_80")
    page.get_by_test_id("visual-settings-close-button").click()
    page.wait_for_timeout(500)
    
    # 3. Return to Library and open Chinese Book
    print("--- Phase 2: Setting Chinese Profile ---")
    page.get_by_test_id("reader-back-button").click()
    page.wait_for_selector("[data-testid='library-view']")
    
    zh_book.click()
    page.wait_for_selector("iframe")
    
    page.get_by_test_id("reader-visual-settings-button").click()
    page.wait_for_selector("[role='status']:has-text('%')")
    
    # 4. Ensure Book Language is set to Chinese
    # If it defaulted to English, we switch it to Chinese to trigger the zh profile
    lang_select = page.get_by_test_id("book-language-select")
    if "Chinese" not in lang_select.inner_text():
        print("Manually switching book language to Chinese...")
        lang_select.click()
        page.get_by_role("option", name="Chinese (zh)").click()
        page.wait_for_timeout(1000)
    
    # 5. Verify Chinese font size is decoupled from English
    zh_size_text = page.text_content("[role='status']:has-text('%')")
    print(f"Chinese size (expected decoupled): {zh_size_text}")
    assert "80%" not in zh_size_text, f"Chinese book should not inherit English font size. Found {zh_size_text}"
    
    # 6. Set Chinese font size to 150%
    while "150%" not in page.text_content("[role='status']:has-text('%')"):
        page.click("button[aria-label='Increase font size']")
        page.wait_for_timeout(100)
        
    utils.capture_screenshot(page, "font_profile_2_zh_set_150")
    page.get_by_test_id("visual-settings-close-button").click()
    page.wait_for_timeout(500)
    
    # 7. Final Persistence Verification
    print("--- Phase 3: Verifying Persistence ---")
    
    # Check English Book again
    page.get_by_test_id("reader-back-button").click()
    page.wait_for_selector("[data-testid='library-view']")
    en_book.click()
    page.wait_for_selector("iframe")
    
    page.get_by_test_id("reader-visual-settings-button").click()
    en_final_size = page.text_content("[role='status']:has-text('%')")
    print(f"Final English size: {en_final_size}")
    assert "80%" in en_final_size, f"English book should have persisted its 80% size. Found {en_final_size}"
    page.get_by_test_id("visual-settings-close-button").click()
    
    # Check Chinese Book again
    page.get_by_test_id("reader-back-button").click()
    page.wait_for_selector("[data-testid='library-view']")
    zh_book.click()
    page.wait_for_selector("iframe")
    
    page.get_by_test_id("reader-visual-settings-button").click()
    zh_final_size = page.text_content("[role='status']:has-text('%')")
    print(f"Final Chinese size: {zh_final_size}")
    assert "150%" in zh_final_size, f"Chinese book should have persisted its 150% size. Found {zh_final_size}"
    
    utils.capture_screenshot(page, "font_profile_3_verified")
    print("Font Profiles Test Passed!")

if __name__ == "__main__":
    pass
