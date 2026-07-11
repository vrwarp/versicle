/**
 * regression: jumpToEnd scrolled-mode resume behavior
 *
 * Tests that jumpToEnd scrolls the iframe so the end of the CFI range lands
 * at the bottom of the viewport in scrolled mode, and falls back to top-aligned
 * jumpTo in paginated mode or when the range cannot be resolved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeReaderEngine } from '@domains/reader/engine/FakeReaderEngine';

// Mirror the jumpToEnd implementation from useReaderController for isolated testing.
function makeJumpToEnd(engine: FakeReaderEngine | null, readerViewMode: 'scrolled' | 'paginated') {
  const engineRef = { current: engine };

  const commands = {
    jumpTo: vi.fn(),
    jumpToEnd: (cfi: string) => {
      try {
        const eng = engineRef.current;
        if (!eng) return;

        if (readerViewMode !== 'scrolled') {
          commands.jumpTo(cfi);
          return;
        }

        void eng.display(cfi)
          .then(() => {
            requestAnimationFrame(() => {
              const currentEngine = engineRef.current;
              if (!currentEngine) return;
              void currentEngine.display(cfi)
                .then(() => {
                  requestAnimationFrame(() => {
                    const stableEngine = engineRef.current;
                    if (!stableEngine) return;
                    const range = stableEngine.getRenderedRange(cfi);
                    if (!range) return;

                    const rect = range.getBoundingClientRect();
                    const views = stableEngine.getContentViews();
                    if (views.length === 0) return;

                    const iframeWindow = views[0].window;
                    const currentScroll = iframeWindow.pageYOffset || 0;
                    const viewportHeight = iframeWindow.innerHeight;
                    const absoluteBottom = currentScroll + rect.bottom;

                    iframeWindow.scrollTo({
                      top: absoluteBottom - viewportHeight,
                      behavior: 'instant',
                    });
                  });
                })
                .catch(() => {});
            });
          })
          .catch(() => {});
      } catch {
        // no-op
      }
    },
  };
  return commands;
}

describe('regression: jumpToEnd scrolled-mode resume behavior', () => {
  let engine: FakeReaderEngine;
  let scrollToSpy: ReturnType<typeof vi.spyOn>;
  let rafCallbacks: Array<FrameRequestCallback>;
  let originalRaf: typeof requestAnimationFrame;

  beforeEach(async () => {
    engine = new FakeReaderEngine();
    await engine.display('chapter1.xhtml');

    rafCallbacks = [];
    originalRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = vi.fn((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });

    scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

    // FakeReaderEngine returns a Range from a detached document; getBoundingClientRect
    // is not functional in jsdom for detached ranges, so we stub getRenderedRange to
    // return a fake Range-shaped object with a working getBoundingClientRect.
    vi.spyOn(engine, 'getRenderedRange').mockReturnValue({
      getBoundingClientRect: () => ({
        top: 40, left: 0, right: 200, bottom: 60, width: 200, height: 20,
        x: 0, y: 40, toJSON: () => ({}),
      }) as DOMRect,
    } as unknown as Range);
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRaf;
    vi.restoreAllMocks();
  });

  async function flushAll() {
    await Promise.resolve();
    await Promise.resolve();
    while (rafCallbacks.length > 0) {
      const cbs = rafCallbacks.splice(0);
      for (const cb of cbs) cb(0);
      await Promise.resolve();
      await Promise.resolve();
    }
  }

  it('calls window.scrollTo with behavior:instant in scrolled mode', async () => {
    const cfi = 'epubcfi(/6/2!/4/2/1:0)';
    const commands = makeJumpToEnd(engine, 'scrolled');

    commands.jumpToEnd(cfi);
    await flushAll();

    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'instant' }),
    );
  });

  it('scrolls so that absoluteBottom - viewportHeight is the scroll target', async () => {
    const cfi = 'epubcfi(/6/2!/4/2/1:0)';
    const commands = makeJumpToEnd(engine, 'scrolled');

    // pageYOffset = 0 (default), rect.bottom = 60, viewportHeight = window.innerHeight
    commands.jumpToEnd(cfi);
    await flushAll();

    const expectedScrollTop = (window.pageYOffset || 0) + 60 - window.innerHeight;
    expect(scrollToSpy).toHaveBeenCalledWith({ top: expectedScrollTop, behavior: 'instant' });
  });

  it('calls jumpTo instead in paginated mode and does not scroll', async () => {
    const cfi = 'epubcfi(/6/2!/4/2/1:0)';
    const commands = makeJumpToEnd(engine, 'paginated');

    commands.jumpToEnd(cfi);
    await flushAll();

    expect(commands.jumpTo).toHaveBeenCalledWith(cfi);
    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it('does not scroll when getRenderedRange returns null', async () => {
    vi.spyOn(engine, 'getRenderedRange').mockReturnValue(null);
    const cfi = 'epubcfi(/6/2!/4/2/1:0)';
    const commands = makeJumpToEnd(engine, 'scrolled');

    commands.jumpToEnd(cfi);
    await flushAll();

    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it('is a no-op and does not throw when engine is null', async () => {
    const cfi = 'epubcfi(/6/2!/4/2/1:0)';
    const commands = makeJumpToEnd(null, 'scrolled');

    expect(() => commands.jumpToEnd(cfi)).not.toThrow();
    await flushAll();
    expect(scrollToSpy).not.toHaveBeenCalled();
  });
});
