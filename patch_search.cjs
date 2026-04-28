const fs = require('fs');
let content = fs.readFileSync('src/hooks/useEpubReader.ts', 'utf8');
console.log(content.substring(content.indexOf('useEffect(() => {'), content.indexOf('useEffect(() => {') + 1000));
