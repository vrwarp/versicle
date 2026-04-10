const fs = require('fs');
let content = fs.readFileSync('src/lib/tts/providers/WebSpeechProvider.test.ts', 'utf8');

content = content.replace(/\/\/ eslint-disable-next-line @typescript-eslint\/no-unsafe-function-type\n/g, '');
content = content.replace(/Record<string, Function\[\]>/g, 'Record<string, ((...args: unknown[]) => void)[]>');
content = content.replace(/callback: Function/g, 'callback: (...args: unknown[]) => void');

fs.writeFileSync('src/lib/tts/providers/WebSpeechProvider.test.ts', content);
