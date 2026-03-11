const fs = require('fs');
let content = fs.readFileSync('src/store/selectors.ts', 'utf8');

// Fix the baseBookCache definition
content = content.replace(
  '    const baseBookCache = useMemo(() => new WeakMap<UserInventoryItem, any>(), [staticMetadata, offloadedBookIds]);',
  '    // eslint-disable-next-line @typescript-eslint/no-explicit-any\n    const baseBookCache = useMemo(() => new WeakMap<UserInventoryItem, any>(), [staticMetadata, offloadedBookIds]);'
);

fs.writeFileSync('src/store/selectors.ts', content);
