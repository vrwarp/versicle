/**
 * anthropicTranslate suite — the Gemini-shaped contract ⇄ Claude Messages API
 * mapping. Pins the two tricky cases the AnthropicClient relies on: image-part
 * translation and top-level-array schema wrapping/unwrapping.
 */
import { describe, expect, it } from 'vitest';
import {
  promptToMessages,
  schemaToTool,
  STRUCTURED_TOOL_NAME,
} from './anthropicTranslate';
import { SchemaType } from './contract';

describe('promptToMessages', () => {
  it('wraps a bare string as one user text turn', () => {
    expect(promptToMessages('hello')).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ]);
  });

  it('translates inlineData image parts into base64 image blocks', () => {
    const messages = promptToMessages({
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { data: 'BASE64BYTES', mimeType: 'image/png' } },
            { text: 'CFI: /6/4' },
          ],
        },
      ],
    });
    expect(messages).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'BASE64BYTES' },
          },
          { type: 'text', text: 'CFI: /6/4' },
        ],
      },
    ]);
  });

  it("maps Gemini's 'model' role to Claude's 'assistant'", () => {
    const [msg] = promptToMessages({
      contents: [{ role: 'model', parts: [{ text: 'ok' }] }],
    });
    expect(msg.role).toBe('assistant');
  });
});

describe('schemaToTool', () => {
  it('uses an object schema directly and unwraps by identity', () => {
    const schema = {
      type: SchemaType.OBJECT,
      properties: { justification: { type: SchemaType.STRING } },
      required: ['justification'],
    };
    const { tool, unwrap } = schemaToTool(schema);
    expect(tool.name).toBe(STRUCTURED_TOOL_NAME);
    expect(tool.input_schema).toBe(schema);
    const value = { justification: 'x' };
    expect(unwrap(value)).toBe(value);
  });

  it('wraps a top-level array schema in an object and unwraps `.result`', () => {
    const arraySchema = {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: { id: { type: SchemaType.STRING }, title: { type: SchemaType.STRING } },
        required: ['id', 'title'],
      },
    };
    const { tool, unwrap } = schemaToTool(arraySchema);
    expect(tool.input_schema).toEqual({
      type: 'object',
      properties: { result: arraySchema },
      required: ['result'],
    });
    const arr = [{ id: '1', title: 'A' }];
    expect(unwrap({ result: arr })).toBe(arr);
  });
});
