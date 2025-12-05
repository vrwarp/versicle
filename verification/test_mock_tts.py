import pytest
from playwright.sync_api import Page, expect

def test_mock_tts_sanity(page: Page):
    """Verifies that the Mock TTS system is loaded and speaks correctly."""
    page.goto("/")

    # Give time for SW registration and voices
    page.wait_for_timeout(2000)

    # Ensure SW is controlling
    page.wait_for_function("!!navigator.serviceWorker.controller", timeout=5000)

    # Check that voices are loaded
    voices_len = page.evaluate("window.speechSynthesis.getVoices().length")
    print(f"Voices length: {voices_len}")
    assert voices_len > 0, "No voices loaded in Mock TTS"

    # Speak
    page.evaluate("""
        const u = new SpeechSynthesisUtterance("Hello world");
        u.rate = 0.2; // 2 seconds per word
        window.speechSynthesis.speak(u);
    """)

    # Check debug output
    debug = page.locator("#tts-debug")
    expect(debug).to_be_visible()

    # Should see "Hello"
    expect(debug).to_have_text("Hello", timeout=5000)

    # Wait for completion
    expect(debug).to_have_text("[[END]]", timeout=10000)

def test_mock_tts_pause_resume(page: Page):
    """Verifies pause and resume functionality."""
    page.goto("/")
    page.wait_for_timeout(2000)
    page.wait_for_function("!!navigator.serviceWorker.controller", timeout=5000)

    debug = page.locator("#tts-debug")

    # Speak a long sentence
    page.evaluate("""
        const u = new SpeechSynthesisUtterance("One two three four five");
        u.rate = 0.2; // 2 seconds per word
        window.speechSynthesis.speak(u);
    """)

    # Wait for first word
    expect(debug).to_have_text("One", timeout=5000)

    # Pause
    page.evaluate("window.speechSynthesis.pause()")

    # Should show paused state
    expect(debug).to_have_text("[[PAUSED]]", timeout=5000)

    # Wait a bit to ensure it doesn't proceed
    page.wait_for_timeout(2000)
    expect(debug).to_have_text("[[PAUSED]]")

    # Resume
    page.evaluate("window.speechSynthesis.resume()")
    expect(debug).to_have_text("[[RESUMED]]", timeout=5000)

    # Should eventually reach "five" or at least proceed
    # "One" (done) -> "two" (pending when paused? SW pauses timer)
    # When resumed, it should speak "two".
    expect(debug).to_have_text("two", timeout=10000)

    # Finish
    page.evaluate("window.speechSynthesis.cancel()")
    expect(debug).to_have_text("[[CANCELED]]", timeout=5000)

def test_mock_tts_cancel(page: Page):
    """Verifies cancel functionality."""
    page.goto("/")
    page.wait_for_timeout(2000)
    page.wait_for_function("!!navigator.serviceWorker.controller", timeout=5000)

    debug = page.locator("#tts-debug")

    page.evaluate("""
        const u = new SpeechSynthesisUtterance("This should be canceled");
        u.rate = 0.2; // 2 seconds per word
        window.speechSynthesis.speak(u);
    """)

    expect(debug).to_have_text("This", timeout=5000)

    page.evaluate("window.speechSynthesis.cancel()")

    expect(debug).to_have_text("[[CANCELED]]", timeout=5000)

    # Wait to ensure no more words
    page.wait_for_timeout(2000)
    expect(debug).to_have_text("[[CANCELED]]")
