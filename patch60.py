import re

with open("verification/utils.py", "r") as f:
    content = f.read()

content = content.replace("https://localhost:5177", "http://localhost:5173")

with open("verification/utils.py", "w") as f:
    f.write(content)
