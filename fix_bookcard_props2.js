import fs from 'fs';

let bcCode = fs.readFileSync('src/components/library/BookCard.tsx', 'utf8');

// For RemoteSessionsSubMenu
bcCode = bcCode.replace(
  "<RemoteSessionsSubMenu\n                  bookId={book.id}\n                  onResumeClick={handleResumeClick}\n                />",
  "<RemoteSessionsSubMenu\n                  bookId={book.id}\n                  allProgress={(book as any).allProgress}\n                  onResumeClick={handleResumeClick}\n                />"
);

// For ResumeBadge
bcCode = bcCode.replace(
  "<ResumeBadge\n          bookId={book.id}\n          onResumeClick={handleResumeClick}\n        />",
  "<ResumeBadge\n          bookId={book.id}\n          allProgress={(book as any).allProgress}\n          onResumeClick={handleResumeClick}\n        />"
);

fs.writeFileSync('src/components/library/BookCard.tsx', bcCode);
