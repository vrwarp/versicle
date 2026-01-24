import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { ContentType } from '../../types/content-analysis';
import { createLogger } from '../logger';

const logger = createLogger('GenAIService');

export interface GenAILogEntry {
  id: string;
  timestamp: number;
  type: 'request' | 'response' | 'error';
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
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
  private log(type: 'request' | 'response' | 'error', method: string, payload: any) {
    if (this.logCallback) {
      this.logCallback({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        type,
        method,
        payload
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
    methodName: string
  ): Promise<T> {
    if (!this.genAI) {
      const error = new Error('GenAI Service not configured (missing API key).');
      this.log('error', methodName, { message: error.message });
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
          this.log('error', methodName, { message: `Model ${currentModelId} exhausted (429). Retrying with next model...`, error: error.message });
          continue;
        } else {
          // If not 429 or rotation disabled, fail immediately
          throw error;
        }
      }
    }

    throw lastError;
  }

  public async generateContent(prompt: string): Promise<string> {
    return this.executeWithRetry(async (genAI, modelId) => {
      this.log('request', 'generateContent', { prompt, model: modelId });
      const model = genAI.getGenerativeModel({ model: modelId });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      this.log('response', 'generateContent', { text });
      return text;
    }, 'generateContent');
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
  public async generateStructured<T>(prompt: string | any, schema: any, generationConfigOverride?: any): Promise<T> {
    // Check for E2E Test Mocks
    if (typeof localStorage !== 'undefined') {
      const mockError = localStorage.getItem('mockGenAIError');
      if (mockError) {
        const error = new Error('Simulated GenAI Error');
        this.log('error', 'generateStructured', { message: error.message, isMock: true });
        throw error;
      }

      const mockResponse = localStorage.getItem('mockGenAIResponse');
      if (mockResponse) {
        logger.info("Using Mock GenAI Response");
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 500));
        try {
          const parsed = JSON.parse(mockResponse) as T;
          this.log('response', 'generateStructured', { parsed, isMock: true });
          return parsed;
        } catch {
          logger.error("Invalid mock response JSON");
          this.log('error', 'generateStructured', { message: "Invalid mock response JSON", isMock: true });
        }
      }
    }
  }
}


return this.executeWithRetry(async (genAI, modelId) => {
  this.log('request', 'generateStructured', { prompt, schema, model: modelId, generationConfigOverride });

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
    this.log('response', 'generateStructured', { text, parsed });
    return parsed;
  } catch (error) {
    logger.error('Failed to parse GenAI response as JSON:', text);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.log('error', 'generateStructured', { message: 'Failed to parse JSON', text, error: (error as any).message });
    throw error;
  }
}, 'generateStructured');
  }

  /**
   * Generates titles for a batch of sections.
   * @param sections Array of objects with id and text.
   * @returns Array of objects with id and title.
   */
  public async generateTOCForBatch(sections: { id: string, text: string }[]): Promise < { id: string, title: string }[] > {
  if(sections.length === 0) return [];

  const prompt = `Generate concise section titles (max 6 words) for the following text segments.
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

  return this.generateStructured<{ id: string, title: string }[]>(prompt, schema);
}

  /**
   * Detects content types for a batch of root nodes.
   * @param nodes Array of objects with id and sampleText.
   * @returns Array of objects with id and type.
   */
  public async detectContentTypes(nodes: { id: string, sampleText: string }[]): Promise < { id: string, type: ContentType }[] > {
  if(nodes.length === 0) return [];

  const prompt = `Analyze the provided text samples from an EPUB book section and classify them into exactly one of the types defined below.

### Categories & Strict Criteria:
1. **'title'**: Structural headers. Includes chapter titles, sub-headings (e.g., "Psalm 16", "Introductory Matters"), or bolded section markers that introduce a new topic.
2. **'footnote'**: Reference or Citation data.
   - **Crucial:** Any text that provides bibliographic info (Author, Book Title, Publisher, Year) or begins with a citation number (e.g., "1 Bruce K. Waltke...") MUST be classified as 'footnote'.
   - Do NOT classify bibliographies as 'other'.
3. **'main'**: Narrative body text. Standard prose, paragraphs of analysis, and block quotes of Scripture or other authors that form the primary discussion.
4. **'table'**: Relational data. Structured lists where specific data points are mapped across columns (e.g., a list mapping a Psalm number to a New Testament reference).
5. **'other'**: Technical artifacts. Use only for CSS remnants, encoding errors, or solitary metadata that serves no editorial purpose.

### Logic Constraints:
- **Priority 1:** If it looks like a bibliography or a source citation, it is a 'footnote'.
- **Priority 2:** If it is a short, isolated line introducing a new section, it is a 'title'.
- **Constraint:** Do not allow the absence of "bottom-of-page" positioning to influence your choice. EPUB text is reflowable; function defines the type, not location.

Return an array of objects with 'id' (matching input) and 'type'.

Samples:
${JSON.stringify(nodes)}`;

  const schema = {
    type: SchemaType.ARRAY,
    items: {
      type: SchemaType.OBJECT,
      properties: {
        id: { type: SchemaType.STRING },
        type: { type: SchemaType.STRING, enum: ['title', 'footnote', 'main', 'table', 'other'] },
      },
      required: ['id', 'type'],
    },
  };

  return this.generateStructured<{ id: string, type: ContentType }[]>(prompt, schema);
}

  public async generateTableAdaptations(
  nodes: { rootCfi: string, imageBlob: Blob }[],
  thinkingBudget: number = 512
): Promise < { cfi: string, adaptation: string }[] > {
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

  for(const node of nodes) {
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
    }
  );
}
}

export const genAIService = GenAIService.getInstance();
