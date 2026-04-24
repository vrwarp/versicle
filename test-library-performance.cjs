const { performance } = require('perf_hooks');

const books = Array.from({ length: 5000 }).map((_, i) => ({
  id: `book-${i}`,
  title: `The Very Long Title Of Book ${i}`,
  author: `Author ${i % 100}`,
}));

// Simulate 100 re-renders where books array reference changes
// (e.g. from useAllBooks due to progress map updates, which happens on every page turn)
const iterations = 100;
const query = ''; // No active search query, which is the most common state!

const startOld = performance.now();
for (let j = 0; j < iterations; j++) {
  // Old way: searchableBooks is re-computed because books array changed
  const searchableBooks = books.map(book => ({
    book,
    searchString: `${(book.title || '').toLowerCase()} ${(book.author || '').toLowerCase()}`
  }));

  const filtered = [];
  for (let i = 0; i < searchableBooks.length; i++) {
    if (searchableBooks[i].searchString.includes(query)) {
      filtered.push(searchableBooks[i].book);
    }
  }
}
const endOld = performance.now();
console.log(`Old way (with intermediate array, no active query): ${(endOld - startOld).toFixed(2)} ms`);

const startNew = performance.now();
for (let j = 0; j < iterations; j++) {
  // New way: mapless single-pass lazy
  const filteredLazy = [];
  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    if (query) {
      const titleMatch = book.title && book.title.toLowerCase().includes(query);
      const authorMatch = book.author && book.author.toLowerCase().includes(query);
      if (titleMatch || authorMatch) {
        filteredLazy.push(book);
      }
    } else {
      filteredLazy.push(book);
    }
  }
}
const endNew = performance.now();
console.log(`New way (mapless single-pass, no active query): ${(endNew - startNew).toFixed(2)} ms`);
