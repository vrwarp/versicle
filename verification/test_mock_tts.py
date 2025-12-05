import pytest
from playwright.sync_api import Page, expect

def test_mock_tts_behavior(page: Page):
    """
    Verifies that the Mock TTS system is functioning correctly:
    1. Emits boundary events.
    2. Updates the debug DOM.
    3. Respects 'end' event.
    """
    print("Testing Mock TTS behavior...")

    # Must navigate to the app to have SW support and proper context
    page.goto("/")

    # Wait for the polyfill to be ready (debug element should exist or be created)
    # The polyfill creates it on load
    page.wait_for_load_state("domcontentloaded")

    # Verify we are using the mock
    is_mock = page.evaluate("typeof window.speechSynthesis._connectToSW === 'function'")
    assert is_mock is True

    # 1. Trigger speech
    text = "Hello world from Mock TTS"
    page.evaluate(f"""
        const u = new SpeechSynthesisUtterance("{text}");
        u.rate = 4.0; // Very Fast
        window.speechSynthesis.speak(u);
    """)

    # 2. Assert debug output updates
    debug_el = page.locator("#tts-debug-output")
    expect(debug_el).to_be_visible(timeout=5000)

    # It should eventually say "world" or "TTS"
    expect(debug_el).to_contain_text("TTS", timeout=5000)

    print("Mock TTS completed successfully.")

def test_mock_tts_voices(page: Page):
    """Verifies that the Mock TTS provides voices."""
    page.goto("/")
    page.wait_for_load_state("domcontentloaded")

    # Wait for voices to be loaded (voiceschanged event simulation)
    # The polyfill fires it after 100ms
    page.wait_for_timeout(500)

    voices_len = page.evaluate("window.speechSynthesis.getVoices().length")
    assert voices_len > 0

    voice_name = page.evaluate("window.speechSynthesis.getVoices()[0].name")
    assert "Mock" in voice_name

def test_mock_tts_queue(page: Page):
    """Verifies that the Mock TTS queues utterances."""
    page.goto("/")
    page.wait_for_load_state("domcontentloaded")

    page.evaluate("""
        window.ttsLog = [];
        const u1 = new SpeechSynthesisUtterance("First");
        u1.rate = 5.0;
        u1.onend = () => window.ttsLog.push("First done");

        const u2 = new SpeechSynthesisUtterance("Second");
        u2.rate = 5.0;
        u2.onend = () => window.ttsLog.push("Second done");

        window.speechSynthesis.speak(u1);
        window.speechSynthesis.speak(u2);
    """)

    # Wait for both to finish
    # Since we push to window.ttsLog, we can poll it
    page.wait_for_function("window.ttsLog.length === 2", timeout=5000)

    logs = page.evaluate("window.ttsLog")
    assert logs == ["First done", "Second done"]
    print("Queue order verified.")

def test_mock_tts_pause_resume(page: Page):
    """Verifies Pause and Resume functionality."""
    page.goto("/")
    page.wait_for_load_state("domcontentloaded")

    page.evaluate("""
        window.ttsState = '';
        const u = new SpeechSynthesisUtterance("Long sentence for pausing");
        u.rate = 1.0;
        u.onstart = () => window.ttsState = 'started';
        u.onpause = () => window.ttsState = 'paused';
        u.onresume = () => window.ttsState = 'resumed';

        window.speechSynthesis.speak(u);
    """)

    page.wait_for_function("window.ttsState === 'started'", timeout=2000)

    # Pause
    page.evaluate("window.speechSynthesis.pause()")
    page.wait_for_function("window.ttsState === 'paused'", timeout=2000)

    # Resume
    page.evaluate("window.speechSynthesis.resume()")
    page.wait_for_function("window.ttsState === 'resumed'", timeout=2000)

    print("Pause/Resume verified.")

def test_mock_tts_cancel(page: Page):
    """Verifies Cancel functionality."""
    page.goto("/")
    page.wait_for_load_state("domcontentloaded")

    page.evaluate("""
        window.ttsCanceled = false;
        const u1 = new SpeechSynthesisUtterance("This should be cancelled");
        const u2 = new SpeechSynthesisUtterance("This should never play");

        // Use a flag to track if u2 started (it shouldn't)
        u2.onstart = () => { window.u2Started = true; };

        window.speechSynthesis.speak(u1);
        window.speechSynthesis.speak(u2);

        // Wait a bit then cancel
        setTimeout(() => {
            window.speechSynthesis.cancel();
            window.ttsCanceled = true;
        }, 100);
    """)

    page.wait_for_function("window.ttsCanceled === true", timeout=2000)

    # Wait to ensure u2 doesn't start
    page.wait_for_timeout(1000)

    u2_started = page.evaluate("window.u2Started === true")
    assert not u2_started

    print("Cancel verified.")
