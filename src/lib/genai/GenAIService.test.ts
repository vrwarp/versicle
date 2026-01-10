import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { genAIService } from './GenAIService';

// Hoisted mocks
const mocks = vi.hoisted(() => {
  return {
    getGenerativeModel: vi.fn(),
    generateContent: vi.fn(),
  };
});

// Mock the module
vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: class MockGoogleGenerativeAI {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructor(_apiKey: string) {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getGenerativeModel(args: any) {
        mocks.getGenerativeModel(args);
        return {
            generateContent: mocks.generateContent
        };
      }
    },
    SchemaType: {
      ARRAY: 'ARRAY',
      OBJECT: 'OBJECT',
      STRING: 'STRING'
    }
  };
});

describe('GenAIService Rotation Logic', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should use the configured model when rotation is disabled', async () => {
    genAIService.configure('fake-key', 'my-specific-model', false);

    mocks.generateContent.mockResolvedValue({
      response: Promise.resolve({ text: () => 'result' })
    });

    await genAIService.generateContent('prompt');

    expect(mocks.getGenerativeModel).toHaveBeenCalledWith({ model: 'my-specific-model' });
    expect(mocks.getGenerativeModel).toHaveBeenCalledTimes(1);
  });

  it('should use a rotation model when rotation is enabled', async () => {
    genAIService.configure('fake-key', 'ignored-model', true);

    mocks.generateContent.mockResolvedValue({
      response: Promise.resolve({ text: () => 'result' })
    });

    await genAIService.generateContent('prompt');

    const callArgs = mocks.getGenerativeModel.mock.calls[0][0];
    const ROTATION_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
    expect(ROTATION_MODELS).toContain(callArgs.model);
  });

  it('should retry with a different model on 429 error when rotation is enabled', async () => {
    genAIService.configure('fake-key', 'ignored-model', true);

    // First call fails with 429
    mocks.generateContent.mockRejectedValueOnce({
      message: '429 RESOURCE_EXHAUSTED'
    });

    // Second call succeeds
    mocks.generateContent.mockResolvedValueOnce({
      response: Promise.resolve({ text: () => 'success' })
    });

    await genAIService.generateContent('prompt');

    expect(mocks.getGenerativeModel).toHaveBeenCalledTimes(2);
    const firstModel = mocks.getGenerativeModel.mock.calls[0][0].model;
    const secondModel = mocks.getGenerativeModel.mock.calls[1][0].model;

    expect(firstModel).not.toBe(secondModel); // Should rotate
  });

  it('should NOT retry on 429 error when rotation is disabled', async () => {
    genAIService.configure('fake-key', 'my-model', false);

    mocks.generateContent.mockRejectedValue({
      message: '429 RESOURCE_EXHAUSTED'
    });

    await expect(genAIService.generateContent('prompt')).rejects.toThrow('429');
    expect(mocks.getGenerativeModel).toHaveBeenCalledTimes(1);
  });

  it('should NOT retry on non-429 error even if rotation is enabled', async () => {
    genAIService.configure('fake-key', 'ignored-model', true);

    mocks.generateContent.mockRejectedValue({
      message: '500 Internal Server Error'
    });

    await expect(genAIService.generateContent('prompt')).rejects.toThrow('500');
    expect(mocks.getGenerativeModel).toHaveBeenCalledTimes(1);
  });

  it('should exhaust all models if all return 429', async () => {
    genAIService.configure('fake-key', 'ignored-model', true);

    mocks.generateContent.mockRejectedValue({
      message: '429 RESOURCE_EXHAUSTED'
    });

    await expect(genAIService.generateContent('prompt')).rejects.toThrow('429');

    // Should try all 2 models
    expect(mocks.getGenerativeModel).toHaveBeenCalledTimes(2);
  });
});
