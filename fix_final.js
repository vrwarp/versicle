import fs from 'fs';

let bcCode = fs.readFileSync('src/components/library/BookCard.tsx', 'utf8');

bcCode = bcCode.replace(
  "allProgress={(book as any).allProgress}",
  "allProgress={((book as unknown) as { allProgress?: Record<string, { percentage: number; currentCfi: string; lastRead: number }> }).allProgress}"
);

bcCode = bcCode.replace(
  "allProgress={(book as any).allProgress}",
  "allProgress={((book as unknown) as { allProgress?: Record<string, { percentage: number; currentCfi: string; lastRead: number }> }).allProgress}"
);

fs.writeFileSync('src/components/library/BookCard.tsx', bcCode);
