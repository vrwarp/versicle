import fs from 'fs';

let bcCode = fs.readFileSync('src/components/library/BookCard.tsx', 'utf8');

// Insert allProgress prop into RemoteSessionsSubMenu
bcCode = bcCode.replace(
  "<RemoteSessionsSubMenu \n            bookId={book.id}",
  "<RemoteSessionsSubMenu \n            bookId={book.id} \n            allProgress={(book as any).allProgress}"
);

// In case the spacing is different
bcCode = bcCode.replace(
  "<RemoteSessionsSubMenu\n                  bookId={book.id}",
  "<RemoteSessionsSubMenu\n                  bookId={book.id}\n                  allProgress={(book as any).allProgress}"
);

// Insert allProgress prop into ResumeBadge
bcCode = bcCode.replace(
  "<ResumeBadge \n            bookId={book.id}",
  "<ResumeBadge \n            bookId={book.id} \n            allProgress={(book as any).allProgress}"
);

// In case the spacing is different
bcCode = bcCode.replace(
  "<ResumeBadge\n              bookId={book.id}",
  "<ResumeBadge\n              bookId={book.id}\n              allProgress={(book as any).allProgress}"
);

fs.writeFileSync('src/components/library/BookCard.tsx', bcCode);
