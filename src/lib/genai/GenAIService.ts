import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { ContentType } from '../../types/content-analysis';

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
  private logCallback: ((entry: GenAILogEntry) => void) | null = null;

  private constructor() {}

  public static getInstance(): GenAIService {
    if (!GenAIService.instance) {
      GenAIService.instance = new GenAIService();
    }
    return GenAIService.instance;
  }

  public configure(apiKey: string, model: string): void {
    this.modelId = model;
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

  public async generateContent(prompt: string): Promise<string> {
    this.log('request', 'generateContent', { prompt, model: this.modelId });

    if (!this.genAI) {
      const error = new Error('GenAI Service not configured (missing API key).');
      this.log('error', 'generateContent', { message: error.message });
      throw error;
    }

    try {
      const model = this.genAI.getGenerativeModel({ model: this.modelId });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      this.log('response', 'generateContent', { text });
      return text;
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.log('error', 'generateContent', { message: (error as any).message, error });
      throw error;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async generateStructured<T>(prompt: string, schema: any): Promise<T> {
    this.log('request', 'generateStructured', { prompt, schema, model: this.modelId });

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
            console.log("Using Mock GenAI Response");
            // Simulate network delay
            await new Promise(resolve => setTimeout(resolve, 500));
            try {
                const parsed = JSON.parse(mockResponse) as T;
                this.log('response', 'generateStructured', { parsed, isMock: true });
                return parsed;
            } catch {
                console.error("Invalid mock response JSON");
                this.log('error', 'generateStructured', { message: "Invalid mock response JSON", isMock: true });
            }
        }
    }

    if (!this.genAI) {
      const error = new Error('GenAI Service not configured (missing API key).');
      this.log('error', 'generateStructured', { message: error.message });
      throw error;
    }

    try {
      const model = this.genAI.getGenerativeModel({
        model: this.modelId,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
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
        console.error('Failed to parse GenAI response as JSON:', text);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.log('error', 'generateStructured', { message: 'Failed to parse JSON', text, error: (error as any).message });
        throw error;
      }
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.log('error', 'generateStructured', { message: (error as any).message, error });
      throw error;
    }
  }

  /**
   * Generates titles for a batch of sections.
   * @param sections Array of objects with id and text.
   * @returns Array of objects with id and title.
   */
  public async generateTOCForBatch(sections: { id: string, text: string }[]): Promise<{ id: string, title: string }[]> {
    if (sections.length === 0) return [];

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
  public async detectContentTypes(nodes: { id: string, sampleText: string }[]): Promise<{ id: string, type: ContentType }[]> {
    if (nodes.length === 0) return [];

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
}

export const genAIService = GenAIService.getInstance();
