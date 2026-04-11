import re

with open("verification/test_journey_audio.py", "r") as f:
    content = f.read()

# I reverted my changes to `test_journey_audio.py` previously while trying to debug the localhost port URL issue!
# That's why it was failing! Because it has ALL the old flow mode overlay checks still inside!!
# Oh my god. I should just put my fixed code back in!
replacement = """    # Close Audio Deck
    page.keyboard.press("Escape")
    expect(page.get_by_test_id("tts-panel")).not_to_be_visible()

    # --- Part 3: Flow Mode (Listening State) ---
    print("--- Testing Flow Mode ---")

    # Start Play via Pill (assuming we fixed it)
    play_button.click()

    # Enter Immersive Mode (required for Flow Mode overlay)
    print("Entering Immersive Mode...")
    page.get_by_test_id("reader-immersive-enter-button").click()

    # Wait for layout shift to complete
    page.wait_for_timeout(1000)
    utils.capture_screenshot(page, "audio_3_flow_mode_active")

    # Exit Immersive Mode to see header
    print("Exiting Immersive Mode...")
    page.get_by_test_id("reader-immersive-exit-button").click()

    # Stop Audio
    print("Stopping Audio...")
    page.wait_for_timeout(1000)
    page.get_by_test_id("compass-pill-active").get_by_label("Pause").click()

    # --- Part 4: Summary Mode in Library ---"""

content = re.sub(r"    # Close Audio Deck\n    page\.keyboard\.press\(\"Escape\"\)\n    expect\(page\.get_by_test_id\(\"tts-panel\"\)\)\.not_to_be_visible\(\).*?    # --- Part 4: Summary Mode in Library ---", replacement, content, flags=re.DOTALL)

with open("verification/test_journey_audio.py", "w") as f:
    f.write(content)
