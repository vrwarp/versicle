const fs = require('fs');
let content = fs.readFileSync('src/lib/cancellable-task-runner.test.ts', 'utf8');

const toReplace = `        // eslint-disable-next-line require-yield
        const generatorFn = function* () {
             throw new Error('Test error');
        };`;

const replacement = `        const generatorFn = function* () {
             yield undefined;
             throw new Error('Test error');
        };`;

content = content.replace(toReplace, replacement);
fs.writeFileSync('src/lib/cancellable-task-runner.test.ts', content);
