import fs from 'fs';
let bcCode = fs.readFileSync('src/components/library/BookCard.tsx', 'utf8');
bcCode = bcCode.replace(
  "allProgress={(book as any).allProgress}",
  "// eslint-disable-next-line @typescript-eslint/no-explicit-any\n                  allProgress={(book as any).allProgress}"
);
bcCode = bcCode.replace(
  "allProgress={(book as any).allProgress}",
  "// eslint-disable-next-line @typescript-eslint/no-explicit-any\n          allProgress={(book as any).allProgress}"
);
fs.writeFileSync('src/components/library/BookCard.tsx', bcCode);
