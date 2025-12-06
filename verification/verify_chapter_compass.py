from playwright.sync_api import sync_playwright, expect
import os

def run_test():
    os.makedirs('verification/screenshots', exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Grant permissions for clipboard if needed, but mostly we need audio context not to block?
        # Using a persistent context might help with IndexedDB but launch should work if we don't need persistence across runs.
        context = browser.new_context()
        page = context.new_page()

        page.on("console", lambda msg: print(f"PAGE LOG: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"PAGE ERROR: {exc}"))

        print("Navigating to app...")
        page.goto("http://localhost:5173")

        # Load Demo Book if empty
        try:
            load_demo_btn = page.get_by_text("Load Demo Book (Alice in Wonderland)")
            if load_demo_btn.is_visible(timeout=3000):
                print("Loading demo book...")
                load_demo_btn.click()
                # Wait for import
                page.wait_for_timeout(3000)
        except:
            print("Library might not be empty, proceeding...")

        # Open Book
        print("Opening book...")
        # Assuming book card has some identifiable text or we click the first one
        # Memory says book cards have id "book-card-${id}".
        # But we don't know the ID.
        # We can search for text "Alice's Adventures in Wonderland"
        page.get_by_text("Alice's Adventures in Wonderland").click()

        # Wait for Reader
        expect(page.get_by_test_id("reader-view")).to_be_visible(timeout=10000)
        print("Reader loaded.")

        # Start Audio
        print("Starting Audio...")
        # Open panel first?
        # In ReaderView, the button calls setAudioPanelOpen(true).
        page.get_by_test_id("reader-audio-button").click()

        # Wait for panel
        expect(page.get_by_test_id("tts-panel")).to_be_visible()

        # Click Play (might fail in headless, so we continue)
        try:
            page.get_by_test_id("tts-play-pause-button").click()
        except:
            print("Clicking play failed or timed out")

        # Wait a bit for status to change to 'playing' or 'loading'
        page.wait_for_timeout(2000)

        # Force State for Compass Pill (since headless TTS often fails)
        print("Forcing TTS state for verification...")
        page.evaluate("""
            if (window.useTTSStore) {
                window.useTTSStore.getState().setChapterInfo("Chapter I", 0, 0.5);
                window.useTTSStore.setState({ status: 'playing', isPlaying: true });
            } else {
                console.error("useTTSStore not found on window");
            }
        """)

        # Close panel? The panel is a sheet. Clicking outside closes it?
        # Or just navigate back. The panel is in a Sheet in App.tsx now.
        # If we click Back button in ReaderView, does the Sheet close?
        # ReaderView is covered by the Sheet?
        # Sheet usually has an overlay. If we are in ReaderView, and Sheet is open, we can't click Reader buttons unless we close Sheet.
        # So we should close the Sheet first.
        # Click overlay or press Escape.
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)

        # Navigate Back to Library
        print("Navigating back to Library...")
        page.get_by_test_id("reader-back-button").click()

        # Wait for Library
        expect(page.get_by_text("My Library")).to_be_visible()

        # Verify Compass Pill
        print("Verifying Compass...")
        # CompassPill has class 'fixed bottom-6'.
        # We can look for text "Chapter"
        try:
            expect(page.get_by_text("Chapter")).to_be_visible()
        except:
            print("Failed to find Chapter text. Taking failure screenshot.")
            page.screenshot(path="verification/screenshots/failure.png")
            raise

        # Take Screenshot
        print("Taking screenshot...")
        page.screenshot(path="verification/screenshots/chapter_compass.png")

        browser.close()
        print("Verification complete.")

if __name__ == "__main__":
    run_test()
