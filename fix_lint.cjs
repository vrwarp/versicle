const fs = require('fs');
let content = fs.readFileSync('src/store/selectors.ts', 'utf8');

// Update to fix the warning
content = content.replace(
  '    // eslint-disable-next-line @typescript-eslint/no-explicit-any\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n    const baseBookCache = useMemo(() => new WeakMap<UserInventoryItem, any>(), [staticMetadata, offloadedBookIds]);',
  '    // eslint-disable-next-line react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any\n    const baseBookCache = useMemo(() => new WeakMap<UserInventoryItem, any>(), [staticMetadata, offloadedBookIds]);'
);

fs.writeFileSync('src/store/selectors.ts', content);
