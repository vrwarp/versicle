/**
 * Smart-TOC title generation (Phase 7 §H feature module): prompt + zod
 * response schema + input-membership validation in ONE place. Prompt text
 * ported verbatim from the legacy GenAIService.generateTOCForBatch
 * (including the non-English translate instruction — a named keeper).
 *
 * Membership clamp (GG-5): entries echoing ids outside the input set are
 * DROPPED (legacy consumers silently ignored unknown ids via Map lookup —
 * dropping preserves that tolerance while keeping hallucinated ids out of
 * the result); shape breaches throw GENAI_INVALID_RESPONSE.
 */
import { z } from 'zod';
import { GenAIInvalidResponseError } from '../errors';
import { SchemaType, type GenAIClient } from '../contract';

export interface TocSectionInput {
  id: string;
  text: string;
}

export interface TocTitleResult {
  id: string;
  title: string;
}

const responseZod = z.array(z.object({ id: z.string(), title: z.string() }));

const responseSchema = {
  type: SchemaType.ARRAY,
  items: {
    type: SchemaType.OBJECT,
    properties: {
      id: { type: SchemaType.STRING },
      title: { type: SchemaType.STRING },
    },
    required: ['id', 'title'],
  },
};

function buildPrompt(sections: TocSectionInput[], language?: string): string {
  let instruction = 'Generate concise section titles (max 6 words) for the following text segments.';
  if (language && !language.startsWith('en')) {
    instruction = `Extract and translate the section titles from the beginning of each text segment below.

Important constraints for the 'title' field:
1. You MUST infer the title directly from the provided text (typically the first few lines).
2. Format the string exactly as: "English Inferred Title (Original Language Inferred Title)"
3. The English portion should prioritize being concise (aim for 6 words or less).

Example:
Input text: "7\n被遺忘的廢墟\n當探險隊踏入這片荒蕪的土地時，通訊設備立刻失去了信號..."
Expected 'title' output: "7 Forgotten Ruins (7 被遺忘的廢墟)"`;
  }

  return `${instruction}

Return an array of objects with 'id' (matching the input) and 'title'.

Sections:
${JSON.stringify(sections)}`;
}

export function validateTocTitles(
  raw: unknown,
  inputIds: ReadonlySet<string>,
): TocTitleResult[] {
  const parsed = responseZod.safeParse(raw);
  if (!parsed.success) {
    throw new GenAIInvalidResponseError('TOC titles response failed schema validation', {
      issues: parsed.error.issues.slice(0, 5).map((i) => i.message),
    });
  }
  return parsed.data.filter((entry) => inputIds.has(entry.id));
}

export async function generateTocTitles(
  client: GenAIClient,
  sections: TocSectionInput[],
  context?: { bookId?: string; bookTitle?: string; language?: string },
): Promise<TocTitleResult[]> {
  if (sections.length === 0) return [];
  const inputIds = new Set(sections.map((s) => s.id));
  return client.generateStructured<TocTitleResult[]>({
    method: 'generateTOCForBatch',
    prompt: buildPrompt(sections, context?.language),
    responseSchema,
    validate: (raw) => validateTocTitles(raw, inputIds),
    // User-initiated feature ("Enhance Titles with AI" button).
    context: { ...context, interactive: true },
  });
}
