import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

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
  private modelId: string = 'gemini-2.5-flash-lite';
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
   * Generates titles for a batch of chapters.
   * @param chapters Array of objects with id and text.
   * @returns Array of objects with id and title.
   */
  public async generateTOCForBatch(chapters: { id: string, text: string }[]): Promise<{ id: string, title: string }[]> {
    if (chapters.length === 0) return [];

    const prompt = `Generate concise chapter titles (max 6 words) for the following chapters.
    Return an array of objects with 'id' (matching the input) and 'title'.

    Chapters:
    ${JSON.stringify(chapters)}`;

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
}

export const genAIService = GenAIService.getInstance();
