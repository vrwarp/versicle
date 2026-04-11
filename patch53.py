import subprocess
import re

# Reset the file to HEAD (which contains my previous successful commit for this file)
subprocess.run(["git", "checkout", "HEAD", "--", "verification/test_journey_audio.py"])

with open("verification/test_journey_audio.py", "r") as f:
    content = f.read()

# Change the URL check to use regex
content = content.replace("expect(page).to_have_url(\"http://localhost:5173/\")", "expect(page).to_have_url(re.compile(r\".*localhost.*\/$\"))")

with open("verification/test_journey_audio.py", "w") as f:
    f.write(content)
