import * as fs from 'fs';
const content = fs.readFileSync('src/lib/cfi-utils.ts', 'utf8');

const target = `                        if (common.endsWith('/') || common.endsWith(':') || common.endsWith('!')) {
                           common = common.slice(0, -1);
                        }`;

const replacement = `                        if (common.endsWith('/') || common.endsWith(':')) {
                           common = common.slice(0, -1);
                        }`;

fs.writeFileSync('src/lib/cfi-utils.ts', content.replace(target, replacement));
