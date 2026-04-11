import re

with open("verification/test_journey_audio.py", "r") as f:
    content = f.read()

# Let's fix the invalid escape sequence warning just to be 100% clean
content = content.replace("expect(page).to_have_url(re.compile(\".*localhost.*\\/$\"))", "expect(page).to_have_url(re.compile(r\".*localhost.*\\/$\"))")

with open("verification/test_journey_audio.py", "w") as f:
    f.write(content)
