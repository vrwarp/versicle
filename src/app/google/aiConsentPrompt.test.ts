/**
 * The "ask on first TTS play" per-book AI consent prompt (P9; the
 * affordance whose existence let app/google/aiConsent.ts exit observe-mode
 * for bookId-carrying calls). Drives the REAL stores; only the dialog
 * primitive and the client-configured probe are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureAiConsentForBook } from './aiConsentPrompt';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { useGenAIStore } from '@store/useGenAIStore';
import { useContentAnalysisStore } from '@store/useContentAnalysisStore';
import { confirmDialog } from '@components/ui/ConfirmDialog';

vi.mock('@components/ui/ConfirmDialog', () => ({
  confirmDialog: vi.fn(),
}));
vi.mock('@app/tts/genaiPort', () => ({
  genAIIsConfigured: vi.fn(() => true),
}));

const confirmMock = vi.mocked(confirmDialog);

describe('ensureAiConsentForBook (ask on first TTS play)', () => {
  beforeEach(() => {
    confirmMock.mockReset();
    usePreferencesStore.setState({ aiConsent: {} });
    useGenAIStore.setState({ isEnabled: true });
    useContentAnalysisStore.setState({ sections: {} });
  });

  it('asks once and persists a grant', async () => {
    confirmMock.mockResolvedValue(true);
    await ensureAiConsentForBook('book-1');
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({ titleKey: 'genai.consent.title' })
    );
    expect(usePreferencesStore.getState().aiConsent['book-1']).toBe(true);

    // Asked-and-answered: never again for this book.
    await ensureAiConsentForBook('book-1');
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it('persists a refusal (asked exactly once; egress stays denied)', async () => {
    confirmMock.mockResolvedValue(false);
    await ensureAiConsentForBook('book-1');
    expect(usePreferencesStore.getState().aiConsent['book-1']).toBe(false);

    await ensureAiConsentForBook('book-1');
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it('never prompts when GenAI is disabled', async () => {
    useGenAIStore.setState({ isEnabled: false });
    await ensureAiConsentForBook('book-1');
    expect(confirmMock).not.toHaveBeenCalled();
    expect(usePreferencesStore.getState().aiConsent['book-1']).toBeUndefined();
  });

  it('never prompts for a grandfathered book (existing analysis records)', async () => {
    useContentAnalysisStore.setState({
      sections: { 'book-1/sec-1': {} } as never,
    });
    await ensureAiConsentForBook('book-1');
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('never prompts without a bookId', async () => {
    await ensureAiConsentForBook(null);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('concurrent calls for the same book stack ONE dialog', async () => {
    let resolveDialog: ((v: boolean) => void) | undefined;
    confirmMock.mockImplementation(
      () => new Promise<boolean>((resolve) => { resolveDialog = resolve; })
    );
    const first = ensureAiConsentForBook('book-1');
    const second = ensureAiConsentForBook('book-1');
    resolveDialog!(true);
    await Promise.all([first, second]);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(usePreferencesStore.getState().aiConsent['book-1']).toBe(true);
  });
});
