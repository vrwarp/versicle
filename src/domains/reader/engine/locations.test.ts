/**
 * The CFI↔percentage registry: loaded from IDB when present, generated in
 * the background otherwise. The `isCurrent()` guards are the interesting
 * part — the legacy code wrote after destroy, so a book closed mid-generate
 * would persist a registry belonging to a book the user had already left.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const getLocations = vi.fn();
const saveLocations = vi.fn();

vi.mock('@data/repos/bookContent', () => ({
  bookContent: {
    getLocations: (...args: unknown[]) => getLocations(...args),
    saveLocations: (...args: unknown[]) => saveLocations(...args),
  },
}));

const { initializeLocations } = await import('./locations');

/** A Book stub exposing just the locations surface the module touches. */
const makeBook = (generateResult: Promise<unknown> = Promise.resolve()) => {
  const load = vi.fn();
  const generate = vi.fn(() => generateResult);
  const save = vi.fn(() => 'generated-registry');

  return {
    book: { locations: { load, generate, save } } as never,
    load,
    generate,
    save,
  };
};

beforeEach(() => {
  getLocations.mockReset();
  saveLocations.mockReset();
  saveLocations.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('initializeLocations with a saved registry', () => {
  it('loads it and reports ready without generating', async () => {
    getLocations.mockResolvedValue({ locations: 'saved-registry' });

    const { book, load, generate } = makeBook();
    const onReady = vi.fn();

    await initializeLocations({ book, bookId: 'b1', isCurrent: () => true, onReady });

    expect(load).toHaveBeenCalledWith('saved-registry');
    expect(generate).not.toHaveBeenCalled();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(saveLocations).not.toHaveBeenCalled();
  });

  it('does nothing once the book is no longer current', async () => {
    getLocations.mockResolvedValue({ locations: 'saved-registry' });

    const { book, load, generate } = makeBook();
    const onReady = vi.fn();

    await initializeLocations({ book, bookId: 'b1', isCurrent: () => false, onReady });

    expect(load).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });
});

describe('initializeLocations without a saved registry', () => {
  it('generates at 1000-character granularity and persists the result', async () => {
    getLocations.mockResolvedValue(null);

    const { book, generate, save } = makeBook();
    const onReady = vi.fn();

    await initializeLocations({ book, bookId: 'b1', isCurrent: () => true, onReady });
    await vi.waitFor(() => { expect(onReady).toHaveBeenCalled(); });

    expect(generate).toHaveBeenCalledWith(1000);
    expect(save).toHaveBeenCalled();
    expect(saveLocations).toHaveBeenCalledWith('b1', 'generated-registry');
  });

  /*
   * epub.js sleeps `pause` ms between sections; the default of 100 makes a
   * long book take many seconds before percentages work at all.
   */
  it('shortens the inter-section pause from the epub.js default', async () => {
    getLocations.mockResolvedValue(null);

    const { book } = makeBook();

    await initializeLocations({ book, bookId: 'b1', isCurrent: () => true, onReady: vi.fn() });

    expect((book as unknown as { locations: { pause: number } }).locations.pause).toBe(10);
  });

  it('resolves before generation finishes — it must not block first paint', async () => {
    getLocations.mockResolvedValue(null);

    let releaseGenerate: () => void = () => {};
    const pending = new Promise<void>((resolve) => { releaseGenerate = resolve; });
    const { book, save } = makeBook(pending);
    const onReady = vi.fn();

    await initializeLocations({ book, bookId: 'b1', isCurrent: () => true, onReady });

    expect(save).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();

    releaseGenerate();
    await vi.waitFor(() => { expect(onReady).toHaveBeenCalled(); });
  });

  /*
   * The two post-generate guards are separate: one before persisting, one
   * before reporting ready. Losing either lets a closed book write.
   */
  it('does not persist when the book was closed during generation', async () => {
    getLocations.mockResolvedValue(null);

    let releaseGenerate: () => void = () => {};
    const pending = new Promise<void>((resolve) => { releaseGenerate = resolve; });
    const { book, save } = makeBook(pending);
    const onReady = vi.fn();
    let current = true;

    await initializeLocations({ book, bookId: 'b1', isCurrent: () => current, onReady });

    current = false;
    releaseGenerate();
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(save).not.toHaveBeenCalled();
    expect(saveLocations).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });

  it('does not report ready when the book closes between persist and ready', async () => {
    getLocations.mockResolvedValue(null);

    const calls: string[] = [];
    let current = true;

    saveLocations.mockImplementation(async () => {
      calls.push('saved');
      current = false;
    });

    const { book } = makeBook();
    const onReady = vi.fn();

    await initializeLocations({ book, bookId: 'b1', isCurrent: () => current, onReady });
    await vi.waitFor(() => { expect(calls).toContain('saved'); });

    expect(onReady).not.toHaveBeenCalled();
  });

  /* A generation failure must be logged, never left as an unhandled rejection. */
  it('swallows a generation failure without rejecting', async () => {
    getLocations.mockResolvedValue(null);

    const { book } = makeBook(Promise.reject(new Error('generate blew up')));
    const onReady = vi.fn();

    await expect(
      initializeLocations({ book, bookId: 'b1', isCurrent: () => true, onReady }),
    ).resolves.toBeUndefined();

    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(onReady).not.toHaveBeenCalled();
  });
});
