import fs from 'fs';

const files = [
  'src/components/ui/CompassPill_Accessibility.test.tsx',
  'src/components/ui/CompassPill.test.tsx',
  'src/components/ui/CompassPill_NoteRecall.test.tsx',
  'src/components/reader/ReaderTTSController.test.tsx',
  'src/components/reader/UnifiedAudioPanel.test.tsx',
  'src/components/reader/TTSAbbreviationSettings.test.tsx',
  'src/components/audio/SatelliteFAB.test.tsx',
  'src/lib/tts/LexiconServiceBible.test.ts',
  'src/lib/tts/AudioContentPipeline_TriggerAnalysis.test.ts',
  'src/lib/tts/AudioPlayerService_ReactiveSubscription.test.ts',
  'src/lib/tts/AudioPlayerService_StateProtection.test.ts',
  'src/lib/tts/LexiconServiceInitialisms.test.ts',
  'src/lib/tts/Normalization.test.ts',
  'src/lib/tts/AudioPlayerService_Critical.test.ts',
  'src/lib/tts/AudioPlayerService_Resume.test.ts',
  'src/lib/tts/LexiconService.test.ts',
  'src/lib/tts/AudioPlayerService.test.ts',
  'src/lib/tts/LexiconServiceSort.test.ts',
  'src/lib/tts/AudioPlayerService_RestoreAnalysis.test.ts',
  'src/lib/tts/AudioPlayerService_MediaSession.test.ts',
  'src/lib/tts/AudioPlayerService_Concurrency.test.ts',
  'src/components/GlobalSettingsDialog.test.tsx',
  'src/components/settings/TTSSettingsTab.test.tsx',
  'src/components/settings/TTSSettingsTab_Accessibility.test.tsx',
  'src/components/settings/TTSSettingsTab_Delete.test.tsx'
];

for (const file of files) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf-8');
    if (content.includes("vi.mock('../../store/useTTSStore'")) {
        // Need to add getDefaultMinSentenceLength to the mock
        if (content.match(/vi\.mock\('\.\.\/\.\.\/store\/useTTSStore', \(\) => \(\{[\s\S]*?useTTSStore/)) {
            content = content.replace(/vi\.mock\('\.\.\/\.\.\/store\/useTTSStore', \(\) => \(\{/, "vi.mock('../../store/useTTSStore', () => ({\n    getDefaultMinSentenceLength: () => 36,");
        }
    } else if (content.includes("vi.mock('../store/useTTSStore'")) {
        if (content.match(/vi\.mock\('\.\.\/store\/useTTSStore', \(\) => \(\{[\s\S]*?useTTSStore/)) {
            content = content.replace(/vi\.mock\('\.\.\/store\/useTTSStore', \(\) => \(\{/, "vi.mock('../store/useTTSStore', () => ({\n    getDefaultMinSentenceLength: () => 36,");
        }
    }

    fs.writeFileSync(file, content);
  }
}
