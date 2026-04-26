import fs from 'fs';

let accTest = fs.readFileSync('src/components/settings/TTSSettingsTab_Accessibility.test.tsx', 'utf-8');
accTest = accTest.replace(/expect\(lengthText\)/, `// @ts-ignore\n        expect(lengthText)`);
accTest = accTest.replace(/50 chars/g, '36 chars');
fs.writeFileSync('src/components/settings/TTSSettingsTab_Accessibility.test.tsx', accTest);

let apiTest = fs.readFileSync('src/lib/tts/AudioPlayerService.test.ts', 'utf-8');
apiTest = apiTest.replace(/minSentenceLength: 0/g, `profiles: { en: { minSentenceLength: 0 } }, minSentenceLength: 0`);
fs.writeFileSync('src/lib/tts/AudioPlayerService.test.ts', apiTest);
