import pytest
from playwright.sync_api import Page, expect

def setup_mock_tts(page: Page):
    """Helper to ensure Mock TTS is ready."""
    page.goto("/")
    # Wait for initial load
    page.wait_for_timeout(1000)

    # Wait for voices to load (signifies polyfill is active)
    try:
        page.wait_for_function("window.speechSynthesis.getVoices().length > 0", timeout=5000)
    except:
        print("Timeout waiting for voices, polyfill might not be injected.")
        # Debug info?
        # Check if window.speechSynthesis is our mock
        is_mock = page.evaluate("window.speechSynthesis.constructor.name === 'MockSpeechSynthesis'")
        print(f"Is Mock Synthesis: {is_mock}")
        raise

def test_mock_tts_sanity(page: Page):
    """Verifies that the Mock TTS system is loaded and speaks correctly."""
    setup_mock_tts(page)

    # Check that voices are loaded
    voices_len = page.evaluate("window.speechSynthesis.getVoices().length")
    print(f"Voices length: {voices_len}")
    assert voices_len > 0, "No voices loaded in Mock TTS"

    # Speak
    page.evaluate("""
        const u = new SpeechSynthesisUtterance("Hello world");
        u.rate = 0.5; // 800ms per word
        window.speechSynthesis.speak(u);
    """)

    # Check debug output
    debug = page.locator("#tts-debug")
    expect(debug).to_be_visible()

    # Should see "Hello"
    expect(debug).to_have_text("Hello", timeout=10000)

    # Wait for completion "world" -> END
    expect(debug).to_have_text("[[END]]", timeout=10000)

def test_mock_tts_pause_resume(page: Page):
    """Verifies pause and resume functionality."""
    setup_mock_tts(page)

    debug = page.locator("#tts-debug")

    # Speak a long sentence
    page.evaluate("""
        const u = new SpeechSynthesisUtterance("One two three four five");
        u.rate = 0.5; // 800ms per word
        window.speechSynthesis.speak(u);
    """)

    # Wait for first word
    expect(debug).to_have_text("One", timeout=10000)

    # Pause
    page.evaluate("window.speechSynthesis.pause()")

    # Should show paused state
    expect(debug).to_have_text("[[PAUSED]]", timeout=10000)

    # Wait a bit
    page.wait_for_timeout(1000)
    expect(debug).to_have_text("[[PAUSED]]")

    # Resume
    page.evaluate("window.speechSynthesis.resume()")
    expect(debug).to_have_text("[[RESUMED]]", timeout=10000)

    # Should eventually reach "two"
    expect(debug).to_have_text("two", timeout=10000)

    # Finish
    page.evaluate("window.speechSynthesis.cancel()")
    expect(debug).to_have_text("[[CANCELED]]", timeout=10000)

def test_mock_tts_cancel(page: Page):
    """Verifies cancel functionality."""
    setup_mock_tts(page)

    debug = page.locator("#tts-debug")

    page.evaluate("""
        const u = new SpeechSynthesisUtterance("This should be canceled");
        u.rate = 0.5; // 800ms per word
        window.speechSynthesis.speak(u);
    """)

    expect(debug).to_have_text("This", timeout=10000)

    page.evaluate("window.speechSynthesis.cancel()")

    expect(debug).to_have_text("[[CANCELED]]", timeout=10000)

    # Wait to ensure no more words
    page.wait_for_timeout(2000)
    expect(debug).to_have_text("[[CANCELED]]")
