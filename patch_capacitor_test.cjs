const fs = require('fs');
let content = fs.readFileSync('src/App_Capacitor.test.tsx', 'utf8');

content = content.replace(/\/\* eslint-disable @typescript-eslint\/no-explicit-any \*\/\n/g, '');
content = content.replace(/\(selector: any\)/g, '(selector: (state: unknown) => unknown)');
content = content.replace(/\({ children }: any\)/g, '({ children }: { children: React.ReactNode })');
content = content.replace(/\({ element }: any\)/g, '({ element }: { element: React.ReactNode })');
content = content.replace(/\(Capacitor\.getPlatform as any\)\.mockReturnValue/g, '(Capacitor.getPlatform as import(\'vitest\').Mock).mockReturnValue');
content = content.replace(/\(Capacitor\.isNativePlatform as any\)\.mockReturnValue/g, '(Capacitor.isNativePlatform as import(\'vitest\').Mock).mockReturnValue');

fs.writeFileSync('src/App_Capacitor.test.tsx', content);
