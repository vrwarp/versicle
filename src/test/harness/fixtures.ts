/**
 * Typed fixture factories for the domain objects tests construct most often.
 * Replaces the `{ bookId: 'x', title: 'y' } as any` pattern: every fixture
 * is a complete, valid object, with overrides typechecked against the real
 * domain types.
 */
import type { BookMetadata, UserInventoryItem } from '~types/db';
import type { TTSQueueItem } from '~types/tts';

export function makeInventoryItem(
  overrides: Partial<UserInventoryItem> & Pick<UserInventoryItem, 'bookId'>,
): UserInventoryItem {
  return {
    title: `Book ${overrides.bookId}`,
    author: 'Test Author',
    addedAt: 1_700_000_000_000,
    lastInteraction: 1_700_000_000_000,
    tags: [],
    status: 'unread',
    ...overrides,
  };
}

export function makeBookMetadata(
  overrides: Partial<BookMetadata> & Pick<BookMetadata, 'id'>,
): BookMetadata {
  return {
    title: `Book ${overrides.id}`,
    author: 'Test Author',
    addedAt: 1_700_000_000_000,
    ...overrides,
  };
}

export function makeTTSQueueItem(overrides: Partial<TTSQueueItem> = {}): TTSQueueItem {
  return {
    text: 'A test sentence for the queue.',
    cfi: 'epubcfi(/6/2!/4/2)',
    ...overrides,
  };
}

/** Build a queue of n items with distinct CFIs. */
export function makeTTSQueue(length: number, overrides: Partial<TTSQueueItem> = {}): TTSQueueItem[] {
  return Array.from({ length }, (_, i) =>
    makeTTSQueueItem({ cfi: `epubcfi(/6/2!/4/${2 * (i + 1)})`, text: `Sentence ${i + 1}.`, ...overrides }),
  );
}
