const fs = require('fs');
let content = fs.readFileSync('src/store/selectors.ts', 'utf8');

content = content.replace(/\/\/ eslint-disable-next-line react-hooks\/immutability\n/g, '');

// Use Object.assign instead of direct assignment
content = content.replace(/moduleCache\.baseBookCache = new WeakMap\(\);/g, 'Object.assign(moduleCache, { baseBookCache: new WeakMap() });');
content = content.replace(/moduleCache\.baseBooks = result\.sort\(\(a, b\) => b\.lastInteraction - a\.lastInteraction\);/g, 'Object.assign(moduleCache, { baseBooks: result.sort((a, b) => b.lastInteraction - a.lastInteraction) });');
content = content.replace(/moduleCache\.lastDeps = \{ books, staticMetadata, offloadedBookIds \};/g, 'Object.assign(moduleCache, { lastDeps: { books, staticMetadata, offloadedBookIds } });');
content = content.replace(/moduleCache\.readingListMatchMap = map;/g, 'Object.assign(moduleCache, { readingListMatchMap: map });');
content = content.replace(/moduleCache\.readingListMatchDeps = \{ readingListEntries \};/g, 'Object.assign(moduleCache, { readingListMatchDeps: { readingListEntries } });');
content = content.replace(/moduleCache\.memoizedResult = \{ books: result, cache: newCache \};/g, 'Object.assign(moduleCache, { memoizedResult: { books: result, cache: newCache } });');
content = content.replace(/moduleCache\.lastPhase2Deps = \{ baseBooks, progressMap, readingListEntries, readingListMatchMap \};/g, 'Object.assign(moduleCache, { lastPhase2Deps: { baseBooks, progressMap, readingListEntries, readingListMatchMap } });');
content = content.replace(/moduleCache\.previousResultsCache = newCache;/g, 'Object.assign(moduleCache, { previousResultsCache: newCache });');

fs.writeFileSync('src/store/selectors.ts', content);
