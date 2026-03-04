import os
import re

files = [
    'test-group.test.ts',
    'test-mapping.test.ts',
    'src/lib/tts/AudioPlayerService.test.ts',
    'src/lib/tts/AudioPlayerService_RestoreAnalysis.test.ts',
    'src/lib/tts/AudioContentPipeline.test.ts'
]

for file in files:
    if os.path.exists(file):
        with open(file, 'r') as f:
            content = f.read()

        if file == 'test-group.test.ts':
            content = content.replace('pipeline.preprocessTableRoots', 'pipeline["tableProcessor"].preprocessTableRoots')

        if file == 'test-mapping.test.ts':
            content = content.replace('pipeline.mapSentencesToAdaptations', 'pipeline["tableProcessor"].mapSentencesToAdaptations')

        if file == 'src/lib/tts/AudioPlayerService_RestoreAnalysis.test.ts':
            content = content.replace("vi.spyOn(pipeline, 'processTableAdaptations')", "vi.spyOn(pipeline['tableProcessor'], 'processTableAdaptations')")

        with open(file, 'w') as f:
            f.write(content)
