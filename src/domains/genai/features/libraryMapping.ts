/**
 * Reading-list ↔ library fuzzy mapping (Phase 7 §H feature module). Prompt
 * ported verbatim from the legacy GenAIService.mapReadingListToLibrary.
 *
 * Membership clamp (GG-5): this generalizes the SmartLinkDialog keeper —
 * every echoed pair must reference a real input entry AND a real input
 * book; hallucinated ids are dropped here so EVERY consumer inherits the
 * defense (the dialog's own filter remains as belt-and-braces).
 */
import { z } from 'zod';
import { GenAIInvalidResponseError } from '../errors';
import { SchemaType, type GenAIClient } from '../contract';

export interface UnmappedEntry {
  filename: string;
  title: string;
  author: string;
}

export interface UnmappedBook {
  bookId: string;
  title: string;
  author: string;
  sourceFilename?: string;
}

export interface LibraryMapping {
  readingListFilename: string;
  libraryBookId: string;
}

const responseZod = z.object({
  mappings: z
    .array(z.object({ readingListFilename: z.string(), libraryBookId: z.string() }))
    .optional(),
});

const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    mappings: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          readingListFilename: { type: SchemaType.STRING },
          libraryBookId: { type: SchemaType.STRING },
        },
        required: ['readingListFilename', 'libraryBookId'],
      },
    },
  },
  required: ['mappings'],
};

function buildPrompt(entries: UnmappedEntry[], books: UnmappedBook[]): string {
  return `
You are a helpful assistant that maps orphan reading list entries to unmapped library books based on their titles and authors.

Here are the unmapped reading list entries:
${entries.map((e) => `- ID: ${e.filename}, Title: "${e.title}", Author: "${e.author}"`).join('\n')}

Here are the unmapped library books:
${books.map((b) => `- ID: ${b.bookId}, Title: "${b.title}", Author: "${b.author}", Filename: "${b.sourceFilename || 'N/A'}"`).join('\n')}

Find all pairs where the reading list entry matches the library book. Return a JSON object with a 'mappings' array containing the pairs.
Only include matches you are highly confident about.
`;
}

export function validateLibraryMappings(
  raw: unknown,
  entryIds: ReadonlySet<string>,
  bookIds: ReadonlySet<string>,
): LibraryMapping[] {
  const parsed = responseZod.safeParse(raw);
  if (!parsed.success) {
    throw new GenAIInvalidResponseError(
      'Library-mapping response failed schema validation',
      { issues: parsed.error.issues.slice(0, 5).map((i) => i.message) },
    );
  }
  // Legacy tolerance: a missing `mappings` array means "no matches".
  return (parsed.data.mappings ?? []).filter(
    (m) => entryIds.has(m.readingListFilename) && bookIds.has(m.libraryBookId),
  );
}

export async function mapReadingListToLibrary(
  client: GenAIClient,
  unmappedEntries: UnmappedEntry[],
  unmappedBooks: UnmappedBook[],
): Promise<LibraryMapping[]> {
  const entryIds = new Set(unmappedEntries.map((e) => e.filename));
  const bookIds = new Set(unmappedBooks.map((b) => b.bookId));
  return client.generateStructured<LibraryMapping[]>({
    method: 'mapReadingListToLibrary',
    prompt: buildPrompt(unmappedEntries, unmappedBooks),
    responseSchema,
    validate: (raw) => validateLibraryMappings(raw, entryIds, bookIds),
    // User-initiated (SmartLinkDialog).
    context: { interactive: true },
  });
}
