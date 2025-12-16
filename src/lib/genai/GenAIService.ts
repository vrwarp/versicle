import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

class GenAIService {
  private static instance: GenAIService;
  private genAI: GoogleGenerativeAI | null = null;
  private modelId: string = 'gemini-2.5-flash-lite';

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

  public isConfigured(): boolean {
    return this.genAI !== null;
  }

  public async generateContent(prompt: string): Promise<string> {
    if (!this.genAI) {
      throw new Error('GenAI Service not configured (missing API key).');
    }

    const model = this.genAI.getGenerativeModel({ model: this.modelId });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async generateStructured<T>(prompt: string, schema: any): Promise<T> {
    if (!this.genAI) {
      throw new Error('GenAI Service not configured (missing API key).');
    }

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
      return JSON.parse(text) as T;
    } catch (error) {
      console.error('Failed to parse GenAI response as JSON:', text);
      throw error;
    }
  }

  /**
   * Generates a concise chapter title for the provided text.
   * @param chapterText The text content of the chapter (truncated if necessary).
   * @returns A promise resolving to an object containing the generated title.
   */
  public async generateChapterTitle(chapterText: string): Promise<{ title: string }> {
    const prompt = `Generate a concise chapter title (max 6 words) based on the following text.
    The title should be descriptive but brief.

    Text:
    ${chapterText}`;

    const schema = {
      type: SchemaType.OBJECT,
      properties: {
        title: { type: SchemaType.STRING },
      },
      required: ['title'],
    };

    return this.generateStructured<{ title: string }>(prompt, schema);
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
