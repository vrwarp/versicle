import re

with open("verification/test_journey_audio.py", "r") as f:
    content = f.read()

content = re.sub(r"expect\(page\)\.to_have_url\(\"http://localhost:5173/\"\)", "expect(page).to_have_url(re.compile(r\".*localhost:\d+/\"))", content)

with open("verification/test_journey_audio.py", "w") as f:
    f.write(content)
