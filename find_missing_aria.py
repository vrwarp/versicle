import os
import re

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # Find all Button tags
    buttons = re.finditer(r'<Button\b[^>]*>', content)
    for match in buttons:
        btn_tag = match.group(0)
        if 'size="icon"' in btn_tag and 'aria-label' not in btn_tag:
            # Maybe the aria-label is in children? Or spread props?
            print(f"Missing aria-label in {filepath}: {btn_tag}")

for root, dirs, files in os.walk('src/components'):
    for file in files:
        if file.endswith('.tsx'):
            process_file(os.path.join(root, file))
