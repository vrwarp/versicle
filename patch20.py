import re

with open("verification/test_journey_visual_reading.py", "r") as f:
    content = f.read()

# E                   AssertionError: Page did not turn after retry. CFI remained epubcfi(/6/6!/4/2[pgepubid00003]/2/2[chap01]/1:0)
# Ah, this time the RIGHT tap failed! Which is forward!
# Wait, why did the RIGHT tap fail?
# "tap_x_right = reader_x + (reader_w * 0.95)"
# And the code for right tap is `x > width * 0.8`.
# Wait, the `x` inside the iframe is `e.clientX`.
# Playwright uses `page.mouse.click(tap_x_right, tap_y)` on the `page`.
# `reader_container.bounding_box()` is relative to the `page`.
# If `tap_x_right = reader_x + 0.95 * reader_w`.
# The event fired inside the iframe has `e.clientX`.
# Is `reader_container` the exact iframe? No, it's `div[data-testid='reader-iframe-container']`.
# The iframe itself has `width: 100%`, `height: 100%` inside it.
# So `reader_w` should equal `iframe.clientWidth`.
# Inside the iframe, `e.clientX` will be `(reader_x + 0.95 * reader_w) - reader_x = 0.95 * reader_w`.
# `0.95 * reader_w` is > `0.8 * reader_w`. So it SHOULD work.
# Unless... what if the event target is a link and it gets blocked?
# I added `if ((e.target as HTMLElement)?.closest('a')) return;` in the last patch. Maybe the tap hits a link?
pass
