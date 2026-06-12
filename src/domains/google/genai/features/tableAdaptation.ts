/**
 * Table-image → teleprompter-narration adaptation (Phase 7 §H feature
 * module). Prompt ported verbatim from the legacy
 * GenAIService.generateTableAdaptations.
 *
 * Membership clamp (GG-5): echoed `cfi` values must come from the input
 * set — hallucinated CFIs are dropped (legacy consumers silently ignored
 * them via Map lookup); shape breaches throw GENAI_INVALID_RESPONSE.
 * NOTE the prompt embeds full-resolution table screenshots as inlineData —
 * the client REDACTS those from the activity log (logging.ts).
 */
import { z } from 'zod';
import { GenAIInvalidResponseError } from '../errors';
import { SchemaType, type GenAIClient, type GenAIPromptPart } from '../contract';

export interface TableAdaptationNode {
  rootCfi: string;
  imageBlob: Blob;
}

export interface TableAdaptationResult {
  cfi: string;
  adaptation: string;
}

const responseZod = z.array(z.object({ cfi: z.string(), adaptation: z.string() }));

const responseSchema = {
  type: SchemaType.ARRAY,
  items: {
    type: SchemaType.OBJECT,
    properties: {
      cfi: { type: SchemaType.STRING },
      adaptation: { type: SchemaType.STRING },
    },
    required: ['cfi', 'adaptation'],
  },
};

const INSTRUCTION_PROMPT = `ACT AS: An expert accessibility specialist and audiobook narrator.
TASK: Convert each of the above table images into a "teleprompter adaptation" for Text-to-Speech playback.

CORE RULES:
  1. NARRATIVE FLOW: Do not say "Row 1, Column 1." Instead, create natural sentences that a person would say when explaining the data to a friend (e.g., "In the category of 'Demographics,' the 'Under 18' group accounts for 22% of the population").
  2. HEADER ANCHORING: Always anchor cell data to its column and row headers so the listener doesn't lose context.
  3. NO PLACEHOLDERS: Do not use phrases like "This is a placeholder" or describe the technical identifiers (CFIs).
  4. ACCURACY: If a cell is unreadable, skip it rather than hallucinating a value.
  5. JSON FORMAT: Return exactly a JSON array of objects: { "cfi": string, "adaptation": string }.

PROCESS:
  - Step 1: Transcribe the headers and data.
  - Step 2: Synthesize into a narrative.
  - Step 3: Match the 'cfi' identifier provided before each image exactly.
    `;

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64data = reader.result as string;
      // Remove data URL prefix (e.g., "data:image/png;base64,")
      resolve(base64data.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function validateTableAdaptations(
  raw: unknown,
  inputCfis: ReadonlySet<string>,
): TableAdaptationResult[] {
  const parsed = responseZod.safeParse(raw);
  if (!parsed.success) {
    throw new GenAIInvalidResponseError(
      'Table-adaptation response failed schema validation',
      { issues: parsed.error.issues.slice(0, 5).map((i) => i.message) },
    );
  }
  return parsed.data.filter((entry) => inputCfis.has(entry.cfi));
}

export async function generateTableAdaptations(
  client: GenAIClient,
  nodes: TableAdaptationNode[],
  thinkingBudget: number = 512,
  context?: { bookId?: string; bookTitle?: string; sectionTitle?: string },
): Promise<TableAdaptationResult[]> {
  if (nodes.length === 0) return [];

  const parts: GenAIPromptPart[] = [];
  for (const node of nodes) {
    const base64 = await blobToBase64(node.imageBlob);
    // Anchor the image to its unique key in the prompt stream
    parts.push({ inlineData: { data: base64, mimeType: node.imageBlob.type } });
    parts.push({ text: `Table Image CFI: ${node.rootCfi}` });
  }
  parts.push({ text: INSTRUCTION_PROMPT });

  const inputCfis = new Set(nodes.map((n) => n.rootCfi));
  return client.generateStructured<TableAdaptationResult[]>({
    method: 'generateTableAdaptations',
    prompt: { contents: [{ role: 'user', parts }] },
    responseSchema,
    validate: (raw) => validateTableAdaptations(raw, inputCfis),
    generationConfig: {
      thinkingConfig: { includeThoughts: false, thinkingBudget },
    },
    context,
  });
}
