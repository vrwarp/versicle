/**
 * MockGenAIClient (Phase 7 §H — the mock-seam exit, GG-4/privacy D9).
 *
 * Replaces the three `localStorage.getItem('mockGenAIResponse')` production
 * seams: this class lives OUTSIDE the production import graph (boundary
 * rule 9 — it is reachable only from `installTestApi()`'s
 * `window.__versicleTest.genai.setMock(...)`, which itself is installed
 * only under `import.meta.env.DEV || VITE_E2E`) and from test files.
 *
 * The fixture's `response` is fed through the SAME `validate` the real
 * client applies, so a fixture that breaches the feature contract fails the
 * journey exactly like a hallucinating model would.
 */
import type { GenAIClient, GenAIRequest } from './contract';

export interface MockGenAIFixture {
  /** Parsed-JSON-equivalent structured response. */
  response?: unknown;
  /** When set, every call rejects with this message. */
  error?: string;
  /** Simulated latency; defaults to the legacy seam's 500ms. */
  delayMs?: number;
}

export class MockGenAIClient implements GenAIClient {
  constructor(private readonly fixture: MockGenAIFixture) {}

  isConfigured(): boolean {
    return true;
  }

  private async simulate(): Promise<void> {
    const delay = this.fixture.delayMs ?? 500;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    if (this.fixture.error) {
      throw new Error(this.fixture.error);
    }
  }

  async generateStructured<T>(request: GenAIRequest<T>): Promise<T> {
    await this.simulate();
    return request.validate(this.fixture.response);
  }

  async generateText(): Promise<string> {
    await this.simulate();
    return typeof this.fixture.response === 'string'
      ? this.fixture.response
      : JSON.stringify(this.fixture.response ?? '');
  }
}
