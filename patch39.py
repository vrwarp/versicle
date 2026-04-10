import re

with open("verification/test_journey_audio.py", "r") as f:
    content = f.read()

# Wait, `play_button` is `page.get_by_test_id("compass-pill-active").get_by_label("Play")`.
# If `compass-pill-active` doesn't exist, it times out.
# Does `compass-pill-active` exist?
# In `ReaderView.tsx`, when does `compass-pill-active` show?
# It shows when `compassState.variant === 'active'`.
# Does closing the audio deck reset the compass state?
# Yes! `setSidebar('none')` or similar. Wait, no, `ReaderView.tsx` has `useEffect(() => { if (activeSidebar !== 'none' || immersiveMode) { resetCompassState(); } }, [activeSidebar, immersiveMode, resetCompassState]);`.
# So when we open the audio deck (`activeSidebar === 'audio-panel'`), it calls `resetCompassState()`.
# When `compassState` is empty (`{}`), the pill is NOT 'active'. It falls back to default.
# Then we CLOSE the audio deck (`activeSidebar === 'none'`).
# Does it become 'active' again?
# The pill state is only set to 'active' when a task is playing or paused, OR when clicking on a sentence.
# In `test_journey_audio.py`, we navigated to Chapter 5. This triggered some logic that set `compassState` to `active`.
# Then we opened the audio deck, which RESET the compass state.
# Then we closed the audio deck. The state is still RESET!
# So `compass-pill-active` is NOT VISIBLE anymore! It's `compass-pill-compact` or nothing!
# So we CANNOT click `play_button`!
# How do we play audio? We can just open the audio deck and click play there, or click the main page to bring up the active pill.
# Let's just click play inside the Audio Deck BEFORE closing it!
# OR we can click on the reader body, which should trigger a sentence selection and bring up the active pill.
# Let's just use the audio deck's play button.

replacement = """    # --- Enhanced Queue Assertions ---
    print("Verifying queue content...")
    queue_items = page.locator("[data-testid^='tts-queue-item-']")
    expect(queue_items.first).to_be_visible(timeout=5000)

    queue_count = queue_items.count()
    print(f"Queue contains {queue_count} items")
    assert queue_count >= 3, f"Expected at least 3 queue items, got {queue_count}"

    # Verify first item has text content (not empty)
    first_item_text = page.get_by_test_id("tts-queue-item-0").inner_text()
    print(f"First queue item: {first_item_text[:80]}...")
    assert len(first_item_text.strip()) > 10, "First queue item should have meaningful text content"

    utils.capture_screenshot(page, "audio_2b_queue_verified")

    # Start Play via Audio Deck before closing
    print("Starting Play via Audio Deck...")
    page.get_by_role("dialog").get_by_label("Play").click()

    # Close Audio Deck
    page.keyboard.press("Escape")
    expect(page.get_by_test_id("tts-panel")).not_to_be_visible()

    # --- Part 3: Flow Mode (Listening State) ---
    print("--- Testing Flow Mode ---")

    # Enter Immersive Mode (required for Flow Mode overlay)
    print("Entering Immersive Mode...")
    page.get_by_test_id("reader-immersive-enter-button").click()"""

# We replace lines 70 to 98
content = re.sub(r"    # --- Enhanced Queue Assertions ---\n.*?print\(\"Entering Immersive Mode\.\.\.\"\)\n    page\.get_by_test_id\(\"reader-immersive-enter-button\"\)\.click\(\)", replacement, content, flags=re.DOTALL)

with open("verification/test_journey_audio.py", "w") as f:
    f.write(content)
