import re

with open("src/components/reader/ReaderView.tsx", "r") as f:
    content = f.read()

# Instead of relying on `e.clientX` which might be flaky depending on whether the event bubbled from iframe or parent,
# Let's see what `e.type` is and where it comes from.
# The previous `UnifiedInputController` used touch events on a transparent div.
# Since we removed `UnifiedInputController`, we are now relying on EPUB.js `rendition.on('click')`.
# Let's modify the thresholds. Maybe 0.2 and 0.8 is too strict? Let's use 0.3 and 0.7 to ensure the click falls within the zone.
replacement = """                if (useReaderUIStore.getState().immersiveMode) {
                    // Because this event fires INSIDE the iframe, e.clientX and e.view.innerWidth are relative to the iframe.
                    const width = e.view?.innerWidth || window.innerWidth;
                    const x = e.clientX;
                    if (x > width * 0.7) {
                        renditionRef.current?.next();
                    } else if (x < width * 0.3) {
                        renditionRef.current?.prev();
                    }
                }"""

content = re.sub(r"                if \(useReaderUIStore\.getState\(\)\.immersiveMode\) \{\n                    // Because this event fires INSIDE the iframe, e\.clientX and e\.view\.innerWidth are relative to the iframe\.\n                    const width = e\.view\?\.innerWidth \|\| window\.innerWidth;\n                    const x = e\.clientX;\n                    if \(x > width \* 0\.8\) \{\n                        renditionRef\.current\?\.next\(\);\n                    \} else if \(x < width \* 0\.2\) \{\n                        renditionRef\.current\?\.prev\(\);\n                    \}\n                \}", replacement, content)

with open("src/components/reader/ReaderView.tsx", "w") as f:
    f.write(content)
