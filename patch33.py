import re

with open("src/components/reader/ReaderView.tsx", "r") as f:
    content = f.read()

replacement = """                    if (x > width * 0.6) {
                        renditionRef.current?.next();
                    } else if (x < width * 0.4) {
                        renditionRef.current?.prev();
                    }"""

content = re.sub(r"                    if \(x > width \* 0\.8\) \{\n                        renditionRef\.current\?\.next\(\);\n                    \} else if \(x < width \* 0\.2\) \{\n                        renditionRef\.current\?\.prev\(\);\n                    \}", replacement, content)

with open("src/components/reader/ReaderView.tsx", "w") as f:
    f.write(content)

with open("verification/test_journey_visual_reading.py", "r") as f:
    content = f.read()

content = content.replace("tap_x_right = reader_x + (reader_w * 0.85)", "tap_x_right = reader_x + (reader_w * 0.8)")
content = content.replace("tap_x_left = reader_x + (reader_w * 0.15)", "tap_x_left = reader_x + (reader_w * 0.2)")

with open("verification/test_journey_visual_reading.py", "w") as f:
    f.write(content)
