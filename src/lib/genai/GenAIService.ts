import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

export interface ChapterStructureResponse {
  titleText?: string;
  hasTitle: boolean;
  footnotes: string[];
}

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

  public async analyzeChapterStructure(text: string): Promise<ChapterStructureResponse> {
    let promptText = '';

    if (text.length <= 3000) {
      promptText = text;
    } else {
      promptText = `
        (First 2000 chars):
        ${text.substring(0, 2000)}
        ...
        (Last 1000 chars):
        ${text.substring(text.length - 1000)}
      `;
    }

    const prompt = `Analyze the following chapter text and identify the structural elements.
    1. If there is a chapter title or header at the beginning, extract its exact text content as "titleText" and set "hasTitle" to true.
    2. Identify any footnote markers or footnote text at the end of the chapter. Return their text content as an array of strings in "footnotes".

    Chapter Text:
    ${promptText}
    `;

    const schema = {
      type: SchemaType.OBJECT,
      properties: {
        titleText: { type: SchemaType.STRING, nullable: true },
        hasTitle: { type: SchemaType.BOOLEAN },
        footnotes: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING }
        }
      },
      required: ["hasTitle", "footnotes"]
    };

    return this.generateStructured<ChapterStructureResponse>(prompt, schema);
  }
}

export const genAIService = GenAIService.getInstance();
