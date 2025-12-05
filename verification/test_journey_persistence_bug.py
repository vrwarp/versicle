import time
import re
from playwright.sync_api import Page, expect
from verification.utils import reset_app, ensure_library_with_book, get_reader_frame

def test_persistence_bug_reproduction(page: Page):
    """
    Reproduction steps:
    1. open the book
    2. go to the 3rd chapter
    3. open tts panel
    4. press play
    5. wait for a few sentences
    6. press pause
    7. refresh page
    8. open tts panel

    Expect behavior: the queue is filled with the lines
    Actual behavior: the queue is empty
    """

    # Setup: Reset and Load book
    reset_app(page)
    ensure_library_with_book(page)

    # 1. Open the book (click the first book card)
    page.locator("[data-testid^='book-card-']").first.click()

    # Wait for reader to load
    expect(page).to_have_url(re.compile(r".*/read/.*"))
    page.wait_for_selector('[data-testid="reader-iframe-container"] iframe', timeout=10000)

    # 2. Go to the 3rd chapter (using TOC)
    # Open TOC
    page.get_by_label("Table of Contents").click()

    # Click 3rd chapter (Chapter III)
    # Note: Alice TOC might vary, let's assume standard Alice structure or just pick the 3rd link
    page.get_by_role("button", name="Chapter III").click()

    # Close TOC if it doesn't close auto (it is a sheet, clicking link usually closes)
    # Wait for chapter load. We can wait for the iframe to contain "Chapter III"
    # Or just wait a bit since checking iframe content is tricky
    time.sleep(2)

    # 3. Open TTS panel
    # We need to find the button. In ReaderView it's usually the headset icon.
    page.get_by_test_id("reader-audio-button").click()

    # Wait for panel to open
    page.locator("h2:has-text('Audio Deck')").wait_for(timeout=5000)

    # 4. Press play
    # Find play button in the panel
    page.get_by_label("Play", exact=True).click()

    # 5. Wait for a few sentences (wait for playback to start and progress)
    # We can check for the active sentence highlighting or just wait time
    time.sleep(3)

    # 6. Press pause
    # Check if we are playing first?
    # The button changes to Pause when playing.
    # But if TTS failed to start (e.g. no voices), it might still show Play or stop immediately.
    # In headless, WebSpeech might not play actually, but the state should update.
    # However, in log I saw "TTS Provider Error SpeechSynthesisErrorEvent".
    # This might mean it errored out and stopped.

    # If stopped, the button is Play.
    # If playing, the button is Pause.

    # Let's try to click Pause if visible, else check if it Stopped.
    pause_btn = page.get_by_label("Pause", exact=True)
    if pause_btn.is_visible():
        pause_btn.click()
    else:
        # If not playing, maybe it finished or error?
        print("Not playing, skipping pause.")

    # 7. Refresh page
    page.reload()

    # Wait for re-load
    expect(page).to_have_url(re.compile(r".*/read/.*"))
    page.wait_for_selector('[data-testid="reader-iframe-container"] iframe', timeout=10000)
    time.sleep(2)

    # 8. Open TTS panel
    page.get_by_test_id("reader-audio-button").click()

    # Assert: Queue is filled
    # We check if there are list items in the queue
    # The queue items usually have text.
    queue_list = page.locator("[data-testid='tts-queue-list']")
    expect(queue_list).to_be_visible(timeout=5000)

    # Check if there are items.
    # If empty, it might say "No text" or just be empty list.
    # Let's count items.
    items = queue_list.locator("[role='button']")
    # Wait for at least one item
    try:
        items.first.wait_for(timeout=5000)
    except:
        pass # Fall through to assertions

    count = items.count()

    # Verify we have items
    assert count > 0, "TTS Queue should not be empty after refresh"

    # Verify the text is visible
    expect(items.first).to_contain_text("Chapter III")
