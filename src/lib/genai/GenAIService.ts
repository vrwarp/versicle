import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { ContentType } from '../../types/content-analysis';
import { createLogger } from '../logger';
import { generateSecureId } from '../crypto';

const logger = createLogger('GenAIService');

function truncateWords(text: string, maxWords: number): string {
  const words = text.trimStart().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(' ') + '…';
}

function truncateChars(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const cut = t.lastIndexOf(' ', maxChars);
  return (cut > 0 ? t.slice(0, cut) : t.slice(0, maxChars)) + '…';
}

export interface GenAILogEntry {
  id: string;
  timestamp: number;
  type: 'request' | 'response' | 'error';
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  bookTitle?: string;
  sectionTitle?: string;
  correlationId?: string;
}

class GenAIService {
  private static instance: GenAIService;
  private genAI: GoogleGenerativeAI | null = null;
  private modelId: string = 'gemini-flash-lite-latest';
  private isRotationEnabled: boolean = false;
  private readonly ROTATION_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
  private logCallback: ((entry: GenAILogEntry) => void) | null = null;

  private constructor() { }

  public static getInstance(): GenAIService {
    if (!GenAIService.instance) {
      GenAIService.instance = new GenAIService();
    }
    return GenAIService.instance;
  }

  public configure(apiKey: string, model: string, enableRotation: boolean = false): void {
    this.modelId = model;
    this.isRotationEnabled = enableRotation;
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    } else {
      this.genAI = null;
    }
  }

  public setLogCallback(callback: (entry: GenAILogEntry) => void) {
    this.logCallback = callback;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private log(type: 'request' | 'response' | 'error', method: string, payload: any, context?: { bookTitle?: string, sectionTitle?: string, correlationId?: string }) {
    if (this.logCallback) {
      this.logCallback({
        id: generateSecureId(),
        timestamp: Date.now(),
        type,
        method,
        payload,
        bookTitle: context?.bookTitle,
        sectionTitle: context?.sectionTitle,
        correlationId: context?.correlationId
      });
    }
  }

  public isConfigured(): boolean {
    // Check for mock mode first
    if (typeof localStorage !== 'undefined' && (localStorage.getItem('mockGenAIResponse') || localStorage.getItem('mockGenAIError'))) {
      return true;
    }
    return this.genAI !== null;
  }

  // Helper to execute with retry logic for model rotation
  private async executeWithRetry<T>(
    operation: (genAI: GoogleGenerativeAI, modelId: string) => Promise<T>,
    methodName: string,
    context?: { bookTitle?: string, sectionTitle?: string, correlationId?: string }
  ): Promise<T> {
    if (!this.genAI) {
      const error = new Error('GenAI Service not configured (missing API key).');
      this.log('error', methodName, { message: error.message }, context);
      throw error;
    }

    // Determine models to try
    let modelsToTry: string[];
    if (this.isRotationEnabled) {
      // Shuffle rotation models
      modelsToTry = [...this.ROTATION_MODELS].sort(() => Math.random() - 0.5);
    } else {
      modelsToTry = [this.modelId];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lastError: any = null;

    for (const currentModelId of modelsToTry) {
      try {
        return await operation(this.genAI, currentModelId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        lastError = error;
        const isResourceExhausted = error.message?.includes('429') || error.status === 429 || error.toString().includes('RESOURCE_EXHAUSTED');

        if (this.isRotationEnabled && isResourceExhausted) {
          this.log('error', methodName, { message: `Model ${currentModelId} exhausted (429). Retrying with next model...`, error: error.message }, context);
          continue;
        } else {
          // If not 429 or rotation disabled, fail immediately
          throw error;
        }
      }
    }

    throw lastError;
  }

  public async generateContent(prompt: string, context?: { bookTitle?: string, sectionTitle?: string }): Promise<string> {
    const correlationId = generateSecureId();
    const fullContext = { ...context, correlationId };

    return this.executeWithRetry(async (genAI, modelId) => {
      this.log('request', 'generateContent', { prompt, model: modelId }, fullContext);
      const model = genAI.getGenerativeModel({ model: modelId });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      this.log('response', 'generateContent', { text }, fullContext);
      return text;
    }, 'generateContent', fullContext);
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result as string;
        // Remove data URL prefix (e.g., "data:image/png;base64,")
        const base64 = base64data.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async generateStructured<T>(prompt: string | any, schema: any, generationConfigOverride?: any, context?: { bookTitle?: string, sectionTitle?: string, correlationId?: string }): Promise<T> {
    const correlationId = context?.correlationId || generateSecureId();
    const fullContext = { ...context, correlationId };

    // Check for E2E Test Mocks
    if (typeof localStorage !== 'undefined') {
      const mockError = localStorage.getItem('mockGenAIError');
      if (mockError) {
        const error = new Error('Simulated GenAI Error');
        this.log('error', 'generateStructured', { message: error.message, isMock: true }, fullContext);
        throw error;
      }

      const mockResponse = localStorage.getItem('mockGenAIResponse');
      if (mockResponse) {
        logger.info("Using Mock GenAI Response");
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 500));
        try {
          const parsed = JSON.parse(mockResponse) as T;
          this.log('response', 'generateStructured', { parsed, isMock: true }, fullContext);
          return parsed;
        } catch {
          logger.error("Invalid mock response JSON");
          this.log('error', 'generateStructured', { message: "Invalid mock response JSON", isMock: true }, fullContext);
        }
      }
    }



    return this.executeWithRetry(async (genAI, modelId) => {
      this.log('request', 'generateStructured', { prompt, schema, model: modelId, generationConfigOverride }, fullContext);

      const model = genAI.getGenerativeModel({
        model: modelId,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          ...(generationConfigOverride || {})
        },
      });

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      try {
        const parsed = JSON.parse(text) as T;
        this.log('response', 'generateStructured', { text, parsed }, fullContext);
        return parsed;
      } catch (error) {
        logger.error('Failed to parse GenAI response as JSON:', text);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.log('error', 'generateStructured', { message: 'Failed to parse JSON', text, error: (error as any).message }, fullContext);
        throw error;
      }
    }, 'generateStructured', fullContext);
  }

  /**
   * Generates titles for a batch of sections.
   * @param sections Array of objects with id and text.
   * @returns Array of objects with id and title.
   */
  public async generateTOCForBatch(sections: { id: string, text: string }[], context?: { bookTitle?: string, language?: string }): Promise<{ id: string, title: string }[]> {
    if (sections.length === 0) return [];

    let instruction = "Generate concise section titles (max 6 words) for the following text segments.";
    if (context?.language && !context.language.startsWith('en')) {
      instruction = `Extract and translate the section titles from the beginning of each text segment below. 

Important constraints for the 'title' field:
1. You MUST infer the title directly from the provided text (typically the first few lines).
2. Format the string exactly as: "English Inferred Title (Original Language Inferred Title)"
3. The English portion should prioritize being concise (aim for 6 words or less).

Example:
Input text: "7\n被遺忘的廢墟\n當探險隊踏入這片荒蕪的土地時，通訊設備立刻失去了信號..."
Expected 'title' output: "7 Forgotten Ruins (7 被遺忘的廢墟)"`;
    }

    const prompt = `${instruction}

Return an array of objects with 'id' (matching the input) and 'title'.

Sections:
${JSON.stringify(sections)}`;

    const schema = {
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

    return this.generateStructured<{ id: string, title: string }[]>(prompt, schema, undefined, context);
  }

  /**
   * Detects content types for a batch of root nodes.
   * Applies asymmetric detail (front 60% ~8-word truncation, tail 40% ~120-char truncation),
   * sparse JSON (omit false flags), and an optional deterministic enumerator hint.
   */
  public async detectContentTypes(
    nodes: { id: string, sampleText: string, leadsWithMarker?: boolean }[],
    hints: { enumeratorCandidate: number },
    context?: { bookTitle?: string, sectionTitle?: string }
  ): Promise<{ classifications: { id: string, type: ContentType }[], justification: string, agreedWithHeuristic: boolean }> {
    if (nodes.length === 0) return { classifications: [], justification: '', agreedWithHeuristic: false };

    const n = nodes.length;
    const splitPoint = Math.ceil(n * 0.6);

    const renderedNodes = nodes.map((node, i) => {
      const isTail = i >= splitPoint;
      const raw = node.sampleText;
      const sampleText = isTail ? truncateChars(raw, 120) : truncateWords(raw, 8);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entry: Record<string, any> = { id: parseInt(node.id, 10), sampleText };
      // A group flagged leadsWithMarker begins with a citation anchor — typical of a footnote
      // or endnote entry that opens with its reference number/symbol.
      if (node.leadsWithMarker) entry.leadsWithMarker = true;
      return entry;
    });

    const hintLines: string[] = [];
    if (hints.enumeratorCandidate >= 0) {
      hintLines.push(`- HINT A (enumerated bibliography): Group ${hints.enumeratorCandidate} starts a consecutive run of numbered entries (e.g. "[1] Author…"). This pattern suggests a bibliography-style reference section starting there.`);
    }
    const hintSection = hintLines.length > 0
      ? `\n### Hints from deterministic analysis (candidates, not ground truth):\n${hintLines.join('\n')}\nIn your justification, explicitly state whether you agree or disagree with each hint and why.\n`
      : '';

    const prompt = `You will be provided an array of text groups from an EPUB book section, ordered as they appear in the book.
Your task is to identify where the end-of-chapter "references" section begins. References include footnotes, bibliographies, citations, or endnotes.

A group may carry "leadsWithMarker": true, meaning that group BEGINS with a citation anchor/marker
(e.g. a footnote or endnote entry that opens with its reference number or symbol). A run of such
groups at the end of the section is a strong indicator of an endnote/footnote block — even when the
entries have no visible enumerator in the sample text.

### Task:
Find the index of the first group that clearly marks the beginning of the references section.
Once the references section begins, everything after it is also references.
If there is no references section at the end, return -1.
${hintSection}
Groups:
${JSON.stringify(renderedNodes)}`;

    const schema = {
      type: SchemaType.OBJECT,
      properties: {
        justification: { type: SchemaType.STRING },
        referenceStartIndex: { type: SchemaType.INTEGER },
        agreedWithHeuristic: { type: SchemaType.BOOLEAN },
      },
      required: ['justification', 'referenceStartIndex', 'agreedWithHeuristic'],
    };

    const result = await this.generateStructured<{ justification: string; referenceStartIndex: number; agreedWithHeuristic: boolean }>(prompt, schema, undefined, context);

    const startIndex = result.referenceStartIndex;
    const classifications = nodes.map((node, index) => ({
      id: node.id,
      type: (startIndex !== -1 && index >= startIndex ? 'reference' : 'main') as ContentType,
    }));

    return { classifications, justification: result.justification, agreedWithHeuristic: result.agreedWithHeuristic };
  }

  public async generateTableAdaptations(
    nodes: { rootCfi: string, imageBlob: Blob }[],
    thinkingBudget: number = 512,
    context?: { bookTitle?: string, sectionTitle?: string }
  ): Promise<{ cfi: string, adaptation: string }[]> {
    const instructionPrompt = `ACT AS: An expert accessibility specialist and audiobook narrator.
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = [];

    for (const node of nodes) {
      const base64 = await this.blobToBase64(node.imageBlob);
      // Anchor the image to its unique key in the prompt stream
      parts.push({
        inlineData: {
          data: base64,
          mimeType: node.imageBlob.type
        }
      });
      parts.push({ text: `Table Image CFI: ${node.rootCfi}` });
    }
    parts.push({ text: instructionPrompt });

    return this.generateStructured<{ cfi: string, adaptation: string }[]>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { contents: [{ role: 'user', parts }] } as any,
      {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            cfi: { type: SchemaType.STRING },
            adaptation: { type: SchemaType.STRING },
          },
          required: ['cfi', 'adaptation'],
        },
      },
      {
        thinkingConfig: { includeThoughts: false, thinkingBudget: thinkingBudget }
      },
      context
    );
  }

  /**
   * Generates a mapping between reading list entries and library books.
   */
  public async mapReadingListToLibrary(
    unmappedEntries: { filename: string, title: string, author: string }[],
    unmappedBooks: { bookId: string, title: string, author: string, sourceFilename?: string }[]
  ): Promise<{ readingListFilename: string, libraryBookId: string }[]> {
    const prompt = `
You are a helpful assistant that maps orphan reading list entries to unmapped library books based on their titles and authors.

Here are the unmapped reading list entries:
${unmappedEntries.map(e => `- ID: ${e.filename}, Title: "${e.title}", Author: "${e.author}"`).join('\n')}

Here are the unmapped library books:
${unmappedBooks.map(b => `- ID: ${b.bookId}, Title: "${b.title}", Author: "${b.author}", Filename: "${b.sourceFilename || 'N/A'}"`).join('\n')}

Find all pairs where the reading list entry matches the library book. Return a JSON object with a 'mappings' array containing the pairs.
Only include matches you are highly confident about.
`;

    const schema = {
      type: SchemaType.OBJECT,
      properties: {
        mappings: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              readingListFilename: { type: SchemaType.STRING },
              libraryBookId: { type: SchemaType.STRING }
            },
            required: ["readingListFilename", "libraryBookId"]
          }
        }
      },
      required: ["mappings"]
    };

    const result = await this.generateStructured<{ mappings: { readingListFilename: string, libraryBookId: string }[] }>(prompt, schema);
    return result.mappings || [];
  }
}

export const genAIService = GenAIService.getInstance();
