import os
import re

files = [
    'src/lib/tts/AudioPlayerService.test.ts'
]

for file in files:
    if os.path.exists(file):
        with open(file, 'r') as f:
            content = f.read()

        # Update AudioPlayerService tests that rely on detectContentTypes
        content = content.replace("genAIService.detectContentTypes.mockResolvedValue", "vi.mocked(genAIService.detectContentTypes).mockResolvedValue")
        content = content.replace("expect(genAIService.detectContentTypes).toHaveBeenCalled();", "expect(genAIService.detectContentTypes).toHaveBeenCalled();")

        with open(file, 'w') as f:
            f.write(content)
