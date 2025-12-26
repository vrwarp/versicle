import pytest
import re
import time
from playwright.sync_api import Page, expect
from verification import utils

def test_journey_audio(page: Page):
    print("Starting Audio Journey...")
    utils.reset_app(page)
    utils.ensure_library_with_book(page)

    # Open Book
    page.locator("[data-testid^='book-card-']").first.click()
    expect(page.get_by_test_id("reader-back-button")).to_be_visible()

    # Navigate to Chapter 5 via TOC to ensure we have content for audio
    print("Navigating to Chapter 5...")
    utils.navigate_to_chapter(page)

    # --- Part 1: Audio HUD Interaction ---
    print("--- Testing Audio HUD ---")
    # Wait for HUD (Compass Pill) in Active/Compact mode (since we have content)
    # The default state when content is available but not playing might be active (if queue populated) or nothing.
    # But navigating to chapter usually populates the queue (as we found earlier).
    # So we expect compass-pill-active.
    expect(page.get_by_test_id("compass-pill-active")).to_be_visible(timeout=10000)
    utils.capture_screenshot(page, "audio_1_hud_visible")

    # Check for Play Button inside the Compass Pill
    # In 'active' variant, there is a play button.
    # aria-label is either "Play" or "Skip to next sentence" depending on state, but initially it should be "Play"
    # Actually, CompassPill code:
    # <Button aria-label={isPlaying ? "Pause" : "Play"} ... /> is only in COMPACT mode?
    # No, in ACTIVE mode:
    # Left Button: Prev/Skip Back
    # Right Button: Next/Skip Forward
    # The Center Info is clickable? No.
    # Wait, looking at CompassPill.tsx:
    # Active Mode does NOT have a Play/Pause button explicitly in the center!
    # It has Prev and Next buttons.
    # Where is the Play button in Active Mode?
    # Ah, CompassPill.tsx source:
    # In Active Mode:
    # Left: SkipBack/ChevronsLeft
    # Right: SkipForward/ChevronsRight
    # Center: Title/Time
    # There is NO Play/Pause button in the Active Mode Pill!
    # The Play/Pause was in the old HUD or FAB.
    # The new design relies on... what?
    # Looking at the design doc/code:
    # "Active Audio Mode ... Description: Standard Audio Player (Play/Pause, Title, Progress Bar)."
    # But `CompassPill.tsx` implementation for `active` variant:
    # It renders left/right buttons and center info.
    # It does NOT render a play button.
    # Unless... `variant='compact'` has play button.
    # `variant='active'` seems to be missing the Play button in the code I read?
    # Let's check `CompassPill.tsx` again.
    #
    # Code snippet from previous `read_file`:
    #   // Active Mode
    #   return (
    #     <div data-testid="compass-pill-active" ...>
    #         {/* Left Button */} ...
    #         {/* Center Info */} ...
    #         {/* Right Button */} ...
    #     </div>
    #   );
    #
    # Wait, how does one Play/Pause in Active Mode?
    # Is the entire pill clickable? No `onClick` on the container in active mode.
    # Is the Center Info clickable? No `onClick`.
    # This seems like a bug or I missed something.
    # In `CompassPill.tsx`:
    #   // Compact Mode
    #   if (variant === 'compact') {
    #       ... Play/Pause Button ...
    #   }
    #
    # But Active Mode seems to lack it.
    # The `SatelliteFAB` was the Play button!
    # If I removed `SatelliteFAB`, where is the Play button?
    # The design doc says: "Active Audio Mode ... Standard Audio Player (Play/Pause, Title, Progress Bar)."
    # If `CompassPill` active variant lacks it, that's a problem.
    #
    # HOWEVER, maybe I should use `compact` mode?
    # `ReaderControlBar` uses: `variant = immersiveMode ? 'compact' : 'active';`
    # So in normal mode, it is 'active'.
    # If 'active' has no play button, how do we play?
    #
    # Maybe `CompassPill` expects `SatelliteFAB` to still exist?
    # The plan said: "Replace <AudioReaderHUD /> with <ReaderControlBar />".
    # `AudioReaderHUD` contained `SatelliteFAB` and `CompassPill`.
    # `ReaderControlBar` contains only `CompassPill`.
    # So `SatelliteFAB` is gone.
    #
    # I must have missed that `CompassPill` active mode needs to include Play/Pause.
    # OR, `active` mode is supposed to work WITH `SatelliteFAB`?
    # But `ReaderControlBar` doesn't render `SatelliteFAB`.
    #
    # CHECK `src/components/audio/CompassPill.tsx` again.
    # I suspect I need to add a Play/Pause button to the Active variant.
    #
    # Start by checking `CompassPill.tsx` content carefully.

    # Assuming for now I need to add it.
    # But for the TEST, I can use the Audio Deck to play.
    # "Part 2: Audio Deck" opens the deck.
    #
    # Let's check the test flow.
    # It tries to click FAB.
    # Since FAB is gone, I should use the Audio Deck to Play/Pause, OR fix the UI.
    # A UI without a Play button is broken.
    #
    # Plan adjustment:
    # 1. Inspect `CompassPill.tsx`.
    # 2. Add Play/Pause button to `active` variant if missing.
    # 3. Update test to click that button instead of FAB.
    #
    # I will proceed with updating the test assuming I will fix the UI.
    # I'll look for `button[aria-label="Play"]` inside `compass-pill-active`.

    play_button = page.get_by_test_id("compass-pill-active").get_by_label("Play")
    expect(play_button).to_be_visible()

    # Click Play
    print("Clicking Play...")
    play_button.click()
    expect(page.get_by_test_id("compass-pill-active").get_by_label("Pause")).to_be_visible(timeout=5000)

    # Click Pause
    print("Clicking Pause...")
    page.get_by_test_id("compass-pill-active").get_by_label("Pause").click()
    expect(play_button).to_be_visible()

    # --- Part 2: Audio Deck ---
    print("--- Testing Audio Deck ---")
    # Open Audio Deck
    page.get_by_test_id("reader-audio-button").click()

    # Verify Sheet Content
    expect(page.get_by_role("dialog")).to_be_visible()
    expect(page.get_by_text("Audio Deck")).to_be_visible()

    # Verify Stage Buttons
    expect(page.get_by_role("dialog").get_by_label("Play")).to_be_visible()
    expect(page.get_by_test_id("tts-rewind-button")).to_be_visible()
    expect(page.get_by_test_id("tts-forward-button")).to_be_visible()

    # Switch to Settings
    print("Switching to Audio Settings...")
    page.get_by_role("button", name="Settings").click()
    expect(page.get_by_text("Voice & Pace")).to_be_visible()
    expect(page.get_by_text("Flow Control")).to_be_visible()

    utils.capture_screenshot(page, "audio_2_deck_settings")

    # Switch back to Queue
    print("Switching back to Queue...")
    page.get_by_role("button", name="Up Next").click()

    # Close Audio Deck
    page.keyboard.press("Escape")
    expect(page.get_by_test_id("tts-panel")).not_to_be_visible()

    # --- Part 3: Flow Mode (Listening State) ---
    print("--- Testing Flow Mode ---")

    # Start Play via Pill (assuming we fixed it)
    play_button.click()

    # Enter Immersive Mode (required for Flow Mode overlay)
    print("Entering Immersive Mode...")
    page.get_by_test_id("reader-immersive-enter-button").click()

    # Verify Overlay Appears (Listening State)
    expect(page.get_by_test_id("flow-mode-breathing-border")).to_be_visible(timeout=5000)
    utils.capture_screenshot(page, "audio_3_flow_mode_active")

    # Verify Text Dimming
    container = page.get_by_test_id("reader-iframe-container")
    expect(container).to_have_css("opacity", "0.4")

    # Verify Curtain Mode
    viewport = page.viewport_size
    width = viewport['width'] if viewport else 1280
    height = viewport['height'] if viewport else 720
    center_x = width / 2
    center_y = height / 2

    # Double Tap to enable Curtain
    print("Enabling Curtain Mode...")
    page.mouse.click(center_x, center_y)
    page.mouse.click(center_x, center_y)

    # Verify Curtain is active (black background)
    overlay = page.get_by_test_id("flow-mode-overlay")
    expect(overlay).to_have_class(re.compile(r"bg-black"))
    expect(page.get_by_test_id("flow-mode-breathing-border")).not_to_be_visible()

    # Verify Peek Mode
    print("Testing Peek Mode...")
    time.sleep(2.0)
    page.mouse.click(center_x, center_y)
    expect(overlay).to_contain_text(re.compile(r"\d+:\d+")) # Check for time format
    utils.capture_screenshot(page, "audio_4_curtain_peek")

    # Disable Curtain Mode (Double Tap)
    print("Disabling Curtain Mode...")
    time.sleep(1.0)
    page.mouse.click(center_x, center_y)
    page.mouse.click(center_x, center_y)

    expect(page.get_by_test_id("flow-mode-breathing-border")).to_be_visible()
    expect(overlay).not_to_have_class(re.compile(r"bg-black"))

    # Stop Audio (via Center Tap on Overlay)
    print("Stopping Audio...")
    time.sleep(1.0)
    page.mouse.click(center_x, center_y)

    # Verify Overlay Disappears
    expect(page.get_by_test_id("flow-mode-breathing-border")).not_to_be_visible(timeout=5000)
    expect(container).to_have_css("opacity", "1")

    # Exit Immersive Mode to see header
    print("Exiting Immersive Mode...")
    page.get_by_test_id("reader-immersive-exit-button").click()

    # --- Part 4: Summary Mode in Library ---
    print("--- Testing Summary Mode in Library ---")
    page.get_by_test_id("reader-back-button").click()

    # Wait for Library
    expect(page).to_have_url("http://localhost:5173/")

    # Check for Summary Pill
    expect(page.get_by_test_id("compass-pill-summary")).to_be_visible()

    # Ensure active pill is gone
    expect(page.get_by_test_id("compass-pill-active")).not_to_be_visible()

    utils.capture_screenshot(page, "audio_5_summary_mode")

    print("Audio Journey Passed!")
