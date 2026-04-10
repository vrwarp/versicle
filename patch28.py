import re

with open("src/components/reader/ReaderView.tsx", "r") as f:
    content = f.read()

# Revert the 0.3 / 0.7 thresholds to 0.2 / 0.8
# The previous version:
#                     if (x > width * 0.7) {
#                         renditionRef.current?.next();
#                     } else if (x < width * 0.3) {
#                         renditionRef.current?.prev();
#                     }
replacement = """                    if (x > width * 0.8) {
                        renditionRef.current?.next();
                    } else if (x < width * 0.2) {
                        renditionRef.current?.prev();
                    }"""

content = re.sub(r"                    if \(x > width \* 0\.7\) \{\n                        renditionRef\.current\?\.next\(\);\n                    \} else if \(x < width \* 0\.3\) \{\n                        renditionRef\.current\?\.prev\(\);\n                    \}", replacement, content)

with open("src/components/reader/ReaderView.tsx", "w") as f:
    f.write(content)

with open("verification/test_journey_visual_reading.py", "r") as f:
    content = f.read()

# The issue in CI was the LEFT tap failed previously, and then the RIGHT tap failed.
# In `test_journey_visual_reading.py`, we calculate tap targets.
# When `page.mouse.click(tap_x_right, tap_y)` is called, it clicks on the parent page.
# If the iframe has a margin or `max-w-2xl px-6` (which adds 24px padding), `tap_x_right` might land on the padding of the `reader-iframe-container` `div`, NOT inside the iframe itself!
# The `reader_container` is `div[data-testid='reader-iframe-container']`.
# The actual `iframe` is a child of this div.
# Because the `div` has `px-6 md:px-8`, the 0.05 and 0.95 positions might literally fall on the padding area!
# If you click on the padding of the container div, it's outside the iframe.
# EPUB.js `newRendition.on('click')` only listens to clicks *inside the iframe document*!
# Therefore, clicking the padding won't trigger `onClick`!
# We must click slightly further inwards to ensure we hit the iframe itself, but still within the 20%/80% zones.
# For example, if we click at 0.15 and 0.85 of the container width!
# 0.15 is still < 0.2, so it will turn left.
# 0.85 is still > 0.8, so it will turn right.
# And 0.15 / 0.85 are far enough from the edge that they bypass the 24px/32px padding (which is usually less than 15% of a 800px screen = 120px).
content = content.replace("tap_x_right = reader_x + (reader_w * 0.95)", "tap_x_right = reader_x + (reader_w * 0.85)")
content = content.replace("tap_x_left = reader_x + (reader_w * 0.05)", "tap_x_left = reader_x + (reader_w * 0.15)")

with open("verification/test_journey_visual_reading.py", "w") as f:
    f.write(content)
