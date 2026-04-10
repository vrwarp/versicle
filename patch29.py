import re

with open("verification/utils.py", "r") as f:
    content = f.read()

# Let's fix test execution port issue for local testing
content = content.replace("http://localhost:5173", "https://localhost:5177")

with open("verification/utils.py", "w") as f:
    f.write(content)
