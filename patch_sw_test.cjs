const fs = require('fs');
let content = fs.readFileSync('src/App_SW_Wait.test.tsx', 'utf8');

content = content.replace(/\s*\/\/ eslint-disable-next-line @typescript-eslint\/no-explicit-any\n/g, '\n');
content = content.replace(/\(selector: any\) =>/g, '(selector: (state: unknown) => unknown) =>');
content = content.replace(/\(waitForServiceWorkerController as any\)\.mockResolvedValue/g, '(waitForServiceWorkerController as import(\'vitest\').Mock).mockResolvedValue');
content = content.replace(/\(waitForServiceWorkerController as any\)\.mockRejectedValue/g, '(waitForServiceWorkerController as import(\'vitest\').Mock).mockRejectedValue');

fs.writeFileSync('src/App_SW_Wait.test.tsx', content);
