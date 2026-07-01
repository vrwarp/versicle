/**
 * Translation between the provider-neutral GenAIClient contract (whose prompt
 * and response-schema shapes are historically Gemini-flavoured) and the Claude
 * Messages API. Kept as a separate, pure module so AnthropicClient stays a thin
 * transport and the tricky shape-mapping is unit-testable in isolation.
 *
 * Two mappings:
 *  1. `promptToMessages` — GenAIPrompt (a bare string, or Gemini
 *     `contents:[{role, parts:[{text}|{inlineData}]}]`) → Claude
 *     `messages:[{role:'user'|'assistant', content: block[]}]`, translating
 *     `inlineData` image parts into Claude `image` blocks.
 *  2. `schemaToTool` — Claude has no Gemini-style `responseSchema`/JSON-mode.
 *     The robust equivalent is a single forced tool: the feature module's schema
 *     (already lowercase JSON-Schema-shaped via `SchemaType`) becomes the tool's
 *     `input_schema`, and `tool_choice` forces it. Claude tool input_schema must
 *     be an OBJECT at the top level, so a top-level ARRAY schema (tocTitles,
 *     tableAdaptation) is wrapped in `{result: <array>}` and unwrapped back out
 *     of the returned `tool_use.input`.
 */
import type { GenAIPrompt, GenAIPromptPart } from './contract';

/** The forced-tool name the structured-output path uses. */
export const STRUCTURED_TOOL_NAME = 'emit_result';

/** A Claude message-content block (the subset we produce). */
type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

/** Gemini part → Claude content block (`inlineData` → base64 `image`). */
function partToBlock(part: GenAIPromptPart): AnthropicContentBlock {
  if ('text' in part) return { type: 'text', text: part.text };
  return {
    type: 'image',
    source: { type: 'base64', media_type: part.inlineData.mimeType, data: part.inlineData.data },
  };
}

/**
 * GenAIPrompt → Claude `messages`. A plain string is one user turn. A multi-part
 * `contents` payload maps role-for-role, translating Gemini's `'model'` role to
 * Claude's `'assistant'`. No feature currently emits a system turn, so `system`
 * is left to the caller.
 */
export function promptToMessages(prompt: GenAIPrompt): AnthropicMessage[] {
  if (typeof prompt === 'string') {
    return [{ role: 'user', content: [{ type: 'text', text: prompt }] }];
  }
  return prompt.contents.map((c) => ({
    role: c.role === 'model' || c.role === 'assistant' ? 'assistant' : 'user',
    content: c.parts.map(partToBlock),
  }));
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface SchemaToolTranslation {
  tool: AnthropicTool;
  /**
   * Pull the contract-shaped value back out of the tool's `input`: identity for
   * object schemas, `.result` for wrapped top-level arrays.
   */
  unwrap: (input: unknown) => unknown;
}

/**
 * Turn a feature-module `responseSchema` into a single Claude tool the model is
 * forced to call. Top-level arrays are wrapped so `input_schema` stays an
 * object (Claude's requirement); the matching `unwrap` reverses it.
 */
export function schemaToTool(responseSchema: object): SchemaToolTranslation {
  const schema = responseSchema as Record<string, unknown>;
  const isArray = schema.type === 'array';
  const input_schema: Record<string, unknown> = isArray
    ? {
        type: 'object',
        properties: { result: schema },
        required: ['result'],
      }
    : schema;
  return {
    tool: {
      name: STRUCTURED_TOOL_NAME,
      description:
        'Return the structured result. Call this tool exactly once with the ' +
        'result in the required shape; do not reply with prose.',
      input_schema,
    },
    unwrap: (input: unknown) =>
      isArray ? (input as { result: unknown } | null)?.result : input,
  };
}
