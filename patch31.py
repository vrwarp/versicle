import re

with open("verification/test_journey_visual_reading.py", "r") as f:
    content = f.read()

# The real issue is the logic in `test_journey_visual_reading.py`.
# When Immersive Mode is entered, the header disappears.
# THIS causes a resize event which forces EPUB.js to rerender.
# Because of the rerender, the text length changes!
# From 11523 to 1300.
# So `initial_text == new_text` evaluates to FALSE!
# And because it is FALSE, the script ASSUMES the right tap successfully turned the page, and skips the retry!
# EVEN THOUGH `cfi_after` is still the same as `cfi_before` (start of chapter)!
# The right tap didn't work because the rerender (from entering immersive mode) was still happening during the tap!
# We need to wait longer after entering Immersive Mode before taking `cfi_before` and `initial_text`, or just wait for the layout to settle!
# Let's fix the test script:
#         print("Entering Immersive Mode...")
#         page.get_by_test_id("reader-immersive-enter-button").click()
#         expect(page.locator("header")).not_to_be_visible()
#         # Wait for re-render
#         page.wait_for_timeout(3000)
#
#         # Get initial text AGAIN after Immersive Mode changes layout
#         frame = get_reader_frame(page)
#         initial_text_immersive = frame.locator("body").inner_text()
#         cfi_before = page.evaluate("...")
#
# Let's patch `verification/test_journey_visual_reading.py` to do this.
replacement = """        print("Entering Immersive Mode...")
        page.get_by_test_id("reader-immersive-enter-button").click()
        expect(page.locator("header")).not_to_be_visible()

        # Wait for layout shift to complete
        page.wait_for_timeout(3000)

        # Get updated text/cfi in immersive mode layout
        frame = get_reader_frame(page)
        initial_text = frame.locator("body").inner_text()"""

content = re.sub(r"        print\(\"Entering Immersive Mode\.\.\.\"\)\n        page\.get_by_test_id\(\"reader-immersive-enter-button\"\)\.click\(\)\n        expect\(page\.locator\(\"header\"\)\)\.not_to_be_visible\(\)", replacement, content)

with open("verification/test_journey_visual_reading.py", "w") as f:
    f.write(content)
