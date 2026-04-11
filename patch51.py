import re

with open("verification/test_journey_audio.py", "r") as f:
    content = f.read()

replacement = """    # Exit Immersive Mode to see header
    print("Exiting Immersive Mode...")
    page.get_by_test_id("reader-immersive-exit-button").click()

    # Stop Audio (via Compass Pill Pause Button, since overlay is gone)
    print("Stopping Audio...")
    page.wait_for_timeout(1000)
    # The active variant Compass Pill exposes a Play/Pause toggle in its center section.
    # We must pause it so that we can see the Summary Pill when we go back to the library.
    page.get_by_test_id("compass-pill-active").get_by_label("Pause").click()

    # --- Part 4: Summary Mode in Library ---"""

content = re.sub(r"    # Exit Immersive Mode to see header\n    print\(\"Exiting Immersive Mode\.\.\.\"\)\n    page\.get_by_test_id\(\"reader-immersive-exit-button\"\)\.click\(\)\n\n    # --- Part 4: Summary Mode in Library ---", replacement, content)

with open("verification/test_journey_audio.py", "w") as f:
    f.write(content)
