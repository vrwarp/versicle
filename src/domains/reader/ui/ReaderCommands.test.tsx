/**
 * `ReaderCommands` — the context + out-of-tree registry, and `ReaderOverlay`
 * — the decorative/interactive portal contract.
 *
 * Both encode a11y and lifecycle rules that only fail at runtime: an
 * overlay in the wrong mode puts focusable children inside an aria-hidden
 * container (the app-shell finding this contract exists to prevent), and a
 * registry that cleared on the WRONG owner's unmount would leave CompassPill
 * driving a dead reader.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { ReaderEngine } from '@domains/reader/engine/ReaderEngine';
import {
  ReaderCommandsProvider,
  readerCommandsRegistry,
  registerReaderCommands,
  useReaderCommands,
  useReaderEngine,
  type ReaderCommands,
} from './ReaderCommands';
import { ReaderOverlay } from './ReaderOverlay';

const makeCommands = (tag = 'a'): ReaderCommands => ({
  jumpTo: vi.fn(),
  jumpToEnd: vi.fn(),
  nextPage: vi.fn(),
  prevPage: vi.fn(),
  nextChapter: vi.fn(),
  prevChapter: vi.fn(),
  playFromSelection: vi.fn(),
  refineSelection: vi.fn(() => ({ cfiRange: tag, text: tag })),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('registerReaderCommands — the out-of-tree registry', () => {
  it('is empty when no reader is open', () => {
    expect(readerCommandsRegistry.get()).toBeNull();
  });

  it('exposes the registered commands and clears them on unregister', () => {
    const commands = makeCommands();

    const unregister = registerReaderCommands(commands);
    expect(readerCommandsRegistry.get()).toBe(commands);

    unregister();
    expect(readerCommandsRegistry.get()).toBeNull();
  });

  it('a replacement takes over immediately', () => {
    const first = makeCommands('first');
    const second = makeCommands('second');
    registerReaderCommands(first);

    const unregisterSecond = registerReaderCommands(second);

    expect(readerCommandsRegistry.get()).toBe(second);
    unregisterSecond();
  });

  it('only the CURRENT owner may clear — a stale unregister is inert', () => {
    const first = makeCommands('first');
    const second = makeCommands('second');
    const unregisterFirst = registerReaderCommands(first);
    const unregisterSecond = registerReaderCommands(second);

    unregisterFirst(); // the superseded reader unmounting late

    expect(readerCommandsRegistry.get()).toBe(second);
    unregisterSecond();
  });

  it('is idempotent — unregistering twice does not clear a successor', () => {
    const first = makeCommands('first');
    const unregisterFirst = registerReaderCommands(first);
    unregisterFirst();
    const second = makeCommands('second');
    const unregisterSecond = registerReaderCommands(second);

    unregisterFirst();

    expect(readerCommandsRegistry.get()).toBe(second);
    unregisterSecond();
  });
});

describe('ReaderCommandsProvider', () => {
  const Probe: React.FC = () => {
    const commands = useReaderCommands();
    const engine = useReaderEngine();
    return (
      <div>
        <span data-testid="refined">{commands.refineSelection()?.text}</span>
        <span data-testid="engine">{engine ? 'live' : 'none'}</span>
      </div>
    );
  };

  it('publishes the commands and engine to in-tree consumers', () => {
    const engine = { id: 'e1' } as unknown as ReaderEngine;

    render(
      <ReaderCommandsProvider commands={makeCommands('ctx')} engine={engine}>
        <Probe />
      </ReaderCommandsProvider>
    );

    expect(screen.getByTestId('refined').textContent).toBe('ctx');
    expect(screen.getByTestId('engine').textContent).toBe('live');
  });

  it('reports a null engine while the book is still loading', () => {
    render(
      <ReaderCommandsProvider commands={makeCommands()} engine={null}>
        <Probe />
      </ReaderCommandsProvider>
    );

    expect(screen.getByTestId('engine').textContent).toBe('none');
  });

  it('registers on mount and CLEARS on unmount', () => {
    const commands = makeCommands();
    const view = render(
      <ReaderCommandsProvider commands={commands} engine={null}>
        <div />
      </ReaderCommandsProvider>
    );
    expect(readerCommandsRegistry.get()).toBe(commands);

    view.unmount();

    expect(readerCommandsRegistry.get()).toBeNull();
  });

  it('re-registers when the commands object identity changes', () => {
    const first = makeCommands('first');
    const second = makeCommands('second');
    const view = render(
      <ReaderCommandsProvider commands={first} engine={null}>
        <div />
      </ReaderCommandsProvider>
    );

    act(() => {
      view.rerender(
        <ReaderCommandsProvider commands={second} engine={null}>
          <div />
        </ReaderCommandsProvider>
      );
    });

    expect(readerCommandsRegistry.get()).toBe(second);
    view.unmount();
  });

  it('does NOT re-register when only the engine changed', () => {
    const commands = makeCommands();
    const view = render(
      <ReaderCommandsProvider commands={commands} engine={null}>
        <div />
      </ReaderCommandsProvider>
    );

    view.rerender(
      <ReaderCommandsProvider commands={commands} engine={{ id: 'e' } as unknown as ReaderEngine}>
        <div />
      </ReaderCommandsProvider>
    );

    expect(readerCommandsRegistry.get()).toBe(commands);
    view.unmount();
  });
});

describe('useReaderCommands / useReaderEngine outside the provider', () => {
  const Bare: React.FC<{ hook: () => unknown }> = ({ hook }) => {
    hook();
    return null;
  };

  it('fail loudly rather than returning undefined', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<Bare hook={useReaderCommands} />)).toThrow(
      'useReaderCommands must be used inside ReaderCommandsProvider'
    );
    expect(() => render(<Bare hook={useReaderEngine} />)).toThrow(
      'useReaderEngine must be used inside ReaderCommandsProvider'
    );
  });
});

describe('ReaderOverlay', () => {
  const container = (): HTMLElement => {
    const node = document.createElement('div');
    node.id = 'epub-container';
    document.body.appendChild(node);
    return node;
  };

  it('renders NOTHING before the epub.js container exists', () => {
    const { container: root } = render(
      <ReaderOverlay mode="decorative" containerNode={null}>
        <span>child</span>
      </ReaderOverlay>
    );

    expect(root.innerHTML).toBe('');
    expect(screen.queryByText('child')).toBeNull();
  });

  it('PORTALS into the epub.js container so it scrolls with the text', () => {
    const node = container();

    render(
      <ReaderOverlay mode="decorative" containerNode={node}>
        <span>child</span>
      </ReaderOverlay>
    );

    expect(node.querySelector('span')?.textContent).toBe('child');
  });

  it('a decorative overlay is hidden from assistive tech AND click-transparent', () => {
    const node = container();

    render(
      <ReaderOverlay mode="decorative" containerNode={node}>
        <span>child</span>
      </ReaderOverlay>
    );

    const overlay = node.firstElementChild as HTMLElement;
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(overlay.className).toContain('pointer-events-none');
    expect(overlay.getAttribute('role')).toBeNull();
  });

  it('an interactive overlay is a NAMED group, never aria-hidden', () => {
    const node = container();

    render(
      <ReaderOverlay mode="interactive" label="Note markers" containerNode={node}>
        <button>note</button>
      </ReaderOverlay>
    );

    const overlay = node.firstElementChild as HTMLElement;
    expect(overlay.getAttribute('role')).toBe('group');
    expect(overlay.getAttribute('aria-label')).toBe('Note markers');
    expect(overlay.getAttribute('aria-hidden')).toBeNull();
  });

  it('keeps the interactive container click-transparent — only children opt in', () => {
    const node = container();

    render(
      <ReaderOverlay mode="interactive" label="Note markers" containerNode={node}>
        <button>note</button>
      </ReaderOverlay>
    );

    expect((node.firstElementChild as HTMLElement).className).toContain('pointer-events-none');
  });

  it('pins the overlay to the container box in both modes', () => {
    const decorative = container();
    const interactive = container();

    render(
      <ReaderOverlay mode="decorative" containerNode={decorative}>
        <span />
      </ReaderOverlay>
    );
    render(
      <ReaderOverlay mode="interactive" label="x" containerNode={interactive}>
        <span />
      </ReaderOverlay>
    );

    for (const node of [decorative, interactive]) {
      const cls = (node.firstElementChild as HTMLElement).className;
      expect(cls).toContain('absolute');
      expect(cls).toContain('inset-0');
      expect(cls).toContain('overflow-visible');
    }
  });

  it('merges extra classes and carries inline custom properties', () => {
    const node = container();

    render(
      <ReaderOverlay
        mode="decorative"
        containerNode={node}
        className="z-30"
        style={{ ['--pinyin-color' as string]: 'red' }}
      >
        <span />
      </ReaderOverlay>
    );

    const overlay = node.firstElementChild as HTMLElement;
    expect(overlay.className).toContain('z-30');
    expect(overlay.className).toContain('absolute');
    expect(overlay.style.getPropertyValue('--pinyin-color')).toBe('red');
  });
});
