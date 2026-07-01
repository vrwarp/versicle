/**
 * domains/genai public surface — the provider-neutral generative-AI domain
 * (hoisted out of domains/google so it is no longer Google-specific). Owns the
 * GenAIClient contract and its implementations (GeminiClient, AnthropicClient,
 * MockGenAIClient) plus the text-embedding family (GeminiEmbeddingClient —
 * embeddings stay on gemini-embedding-2 regardless of the text-gen provider).
 * Other domains import THIS module only (boundary rule 3).
 *
 * First-use splitting discipline (Phase 8 §A): the barrel exports ONLY the
 * lazy facades + holders + contract types — never the concrete Gemini/Anthropic
 * implementation classes or the feature modules (they carry module-scope zod
 * schemas that defeat tree-shaking). The composition root installs the lazy
 * facade; feature modules load via deep dynamic imports at their call sites.
 * check 4 of scripts/check-worker-chunk.mjs pins the implementations out of the
 * emitted entry closure.
 */

// --- GenAI text generation ---
export { makeLazyGenAIClient } from './lazyClient';
export { MockGenAIClient, type MockGenAIFixture } from './MockGenAIClient';
export { getGenAIClient, setGenAIClient } from './holder';
export { type GenAILogEntry } from './logging';
export type { GenAIProvider } from './contract';

// --- GenAI embedding (stays Gemini: gemini-embedding-2) ---
export { makeLazyEmbeddingClient } from './embedding/lazyClient';
export { getEmbeddingClient, setEmbeddingClient } from './embedding/holder';
export type {
  EmbeddingClient,
  EmbeddingConfig,
  EmbeddingProfile,
} from './embedding/contract';
export { MockEmbeddingClient } from './embedding/MockEmbeddingClient';
