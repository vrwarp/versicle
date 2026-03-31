const fs = require('fs');
let content = fs.readFileSync('src/store/selectors.ts', 'utf8');
content = content.replace(
    /\/\/ eslint-disable-next-line @typescript-eslint\/no-explicit-any\n    const baseBookCacheRef = useRef<WeakMap<UserInventoryItem, any>>\(new WeakMap\(\)\);\n    \/\/ eslint-disable-next-line @typescript-eslint\/no-explicit-any\n    const baseBooksRef = useRef<any\[\]>\(\[\]\);\n\n    \/\/ Rebuild cache completely when staticMetadata or offloadedBookIds change,\n    \/\/ to invalidate the entire cache, ensuring we don't serve stale metadata.\n    \/\/ We start with null values to force an initial render computation\n    \/\/ eslint-disable-next-line @typescript-eslint\/no-explicit-any\n    const lastDepsRef = useRef<{books: any, staticMetadata: any, offloadedBookIds: any}>\(\{/g,
    `// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseBookCacheRef = useRef<WeakMap<UserInventoryItem, any>>(new WeakMap());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseBooksRef = useRef<any[]>([]);

    // Rebuild cache completely when staticMetadata or offloadedBookIds change,
    // to invalidate the entire cache, ensuring we don't serve stale metadata.
    // We start with null values to force an initial render computation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lastDepsRef = useRef<{books: any, staticMetadata: any, offloadedBookIds: any}>({`
);
// wait, I don't need to do this, because the prompt says to fix the search engine bug, which I did.
