import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ReaderControlBar } from '../ReaderControlBar';
import { useReaderUIStore } from '../../../store/useReaderUIStore';
import { useInventoryStore } from '../../../store/useInventoryStore';
import { useProgressStore } from '../../../store/useProgressStore';
import { useAnnotationStore } from '../../../store/useAnnotationStore';
import { useTTSStore } from '../../../store/useTTSStore';
import { useToastStore } from '../../../store/useToastStore';

// --- Hoisted Spies ---
const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn()
}));

// --- Mocks ---

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('zustand/react/shallow', () => ({
  useShallow: (selector: any) => selector
}));

// Mock LexiconManager (Path corrected)
vi.mock('../LexiconManager', () => ({
  LexiconManager: ({ open, onOpenChange, initialTerm }: any) => (
    open ? (
      <div data-testid="lexicon-manager-mock">
        Lexicon Manager Open: {initialTerm}
        <button onClick={() => onOpenChange(false)}>Close</button>
      </div>
    ) : <div data-testid="lexicon-manager-closed" />
  )
}));

// Mock CompassPill (Path corrected)
vi.mock('../../ui/CompassPill', () => ({
  CompassPill: ({ variant, onClick, onAnnotationAction, progress }: any) => (
    <div data-testid={`compass-pill-${variant}`} data-progress={progress} onClick={onClick}>
      {variant}
      <button onClick={() => onAnnotationAction && onAnnotationAction('color', 'yellow')}>Color</button>
      <button onClick={() => onAnnotationAction && onAnnotationAction('pronounce')}>Pronounce</button>
    </div>
  ),
  ActionType: {}
}));

// --- Inlined Store Mocks (to avoid hoisting issues) ---

vi.mock('../../../store/useReaderUIStore', async () => {
  const React = await import('react');
  const shallowEqual = (objA: any, objB: any) => {
    if (Object.is(objA, objB)) return true;
    if (typeof objA !== 'object' || objA === null || typeof objB !== 'object' || objB === null) return false;
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);
    if (keysA.length !== keysB.length) return false;
    for (let i = 0; i < keysA.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(objB, keysA[i]) || !Object.is(objA[keysA[i]], objB[keysA[i]])) {
        return false;
      }
    }
    return true;
  };

  let state = {
    popover: { visible: false, text: '', cfiRange: '' },
    hidePopover: vi.fn(),
    immersiveMode: false,
    currentBookId: null,
    currentSectionTitle: null,
    playFromSelection: vi.fn()
  };
  const listeners = new Set<(s: any) => void>();

  const setState = (u: any) => { state = { ...state, ...u }; listeners.forEach(l => l(state)); };

  const useReaderUIStore = (selector: any) => {
    const selectorRef = React.useRef(selector);
    selectorRef.current = selector;
    const [snap, setSnap] = React.useState(() => selector(state));
    const snapRef = React.useRef(snap);

    React.useEffect(() => {
        const l = (s: any) => {
            const next = selectorRef.current(s);
            if (!shallowEqual(snapRef.current, next)) {
                snapRef.current = next;
                setSnap(next);
            }
        };
        listeners.add(l);
        return () => { listeners.delete(l); };
    }, []);
    return snap;
  };
  (useReaderUIStore as any).setState = setState;
  (useReaderUIStore as any).getState = () => state;
  return { useReaderUIStore };
});

vi.mock('../../../store/useInventoryStore', async () => {
  const React = await import('react');
  const shallowEqual = (objA: any, objB: any) => {
    if (Object.is(objA, objB)) return true;
    if (typeof objA !== 'object' || objA === null || typeof objB !== 'object' || objB === null) return false;
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);
    if (keysA.length !== keysB.length) return false;
    for (let i = 0; i < keysA.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(objB, keysA[i]) || !Object.is(objA[keysA[i]], objB[keysA[i]])) {
        return false;
      }
    }
    return true;
  };

  let state = { books: {} };
  const listeners = new Set<(s: any) => void>();

  const setState = (u: any) => { state = { ...state, ...u }; listeners.forEach(l => l(state)); };

  const useInventoryStore = (selector: any) => {
    const selectorRef = React.useRef(selector);
    selectorRef.current = selector;
    const [snap, setSnap] = React.useState(() => selector(state));
    const snapRef = React.useRef(snap);

    React.useEffect(() => {
        const l = (s: any) => {
            const next = selectorRef.current(s);
            if (!shallowEqual(snapRef.current, next)) {
                snapRef.current = next;
                setSnap(next);
            }
        };
        listeners.add(l);
        return () => { listeners.delete(l); };
    }, []);
    return snap;
  };
  (useInventoryStore as any).setState = setState;
  (useInventoryStore as any).getState = () => state;
  return { useInventoryStore };
});

vi.mock('../../../store/useProgressStore', async () => {
  const React = await import('react');
  const shallowEqual = (objA: any, objB: any) => {
    if (Object.is(objA, objB)) return true;
    if (typeof objA !== 'object' || objA === null || typeof objB !== 'object' || objB === null) return false;
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);
    if (keysA.length !== keysB.length) return false;
    for (let i = 0; i < keysA.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(objB, keysA[i]) || !Object.is(objA[keysA[i]], objB[keysA[i]])) {
        return false;
      }
    }
    return true;
  };

  let state = { progress: {} };
  const listeners = new Set<(s: any) => void>();

  const setState = (u: any) => { state = { ...state, ...u }; listeners.forEach(l => l(state)); };

  const useProgressStore = (selector: any) => {
    const selectorRef = React.useRef(selector);
    selectorRef.current = selector;
    const [snap, setSnap] = React.useState(() => selector(state));
    const snapRef = React.useRef(snap);

    React.useEffect(() => {
        const l = (s: any) => {
            const next = selectorRef.current(s);
            if (!shallowEqual(snapRef.current, next)) {
                snapRef.current = next;
                setSnap(next);
            }
        };
        listeners.add(l);
        return () => { listeners.delete(l); };
    }, []);
    return snap;
  };
  (useProgressStore as any).setState = setState;
  (useProgressStore as any).getState = () => state;
  return { useProgressStore };
});

vi.mock('../../../store/useAnnotationStore', async () => {
  const React = await import('react');
  const shallowEqual = (objA: any, objB: any) => {
    if (Object.is(objA, objB)) return true;
    if (typeof objA !== 'object' || objA === null || typeof objB !== 'object' || objB === null) return false;
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);
    if (keysA.length !== keysB.length) return false;
    for (let i = 0; i < keysA.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(objB, keysA[i]) || !Object.is(objA[keysA[i]], objB[keysA[i]])) {
        return false;
      }
    }
    return true;
  };

  let state = { addAnnotation: vi.fn() };
  const listeners = new Set<(s: any) => void>();

  const setState = (u: any) => { state = { ...state, ...u }; listeners.forEach(l => l(state)); };

  const useAnnotationStore = (selector: any) => {
    const selectorRef = React.useRef(selector);
    selectorRef.current = selector;
    const [snap, setSnap] = React.useState(() => selector(state));
    const snapRef = React.useRef(snap);

    React.useEffect(() => {
        const l = (s: any) => {
            const next = selectorRef.current(s);
            if (!shallowEqual(snapRef.current, next)) {
                snapRef.current = next;
                setSnap(next);
            }
        };
        listeners.add(l);
        return () => { listeners.delete(l); };
    }, []);
    return snap;
  };
  (useAnnotationStore as any).setState = setState;
  (useAnnotationStore as any).getState = () => state;
  return { useAnnotationStore };
});

vi.mock('../../../store/useTTSStore', async () => {
  const React = await import('react');
  const shallowEqual = (objA: any, objB: any) => {
    if (Object.is(objA, objB)) return true;
    if (typeof objA !== 'object' || objA === null || typeof objB !== 'object' || objB === null) return false;
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);
    if (keysA.length !== keysB.length) return false;
    for (let i = 0; i < keysA.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(objB, keysA[i]) || !Object.is(objA[keysA[i]], objB[keysA[i]])) {
        return false;
      }
    }
    return true;
  };

  let state = { queue: [], isPlaying: false, play: vi.fn() };
  const listeners = new Set<(s: any) => void>();

  const setState = (u: any) => { state = { ...state, ...u }; listeners.forEach(l => l(state)); };

  const useTTSStore = (selector: any) => {
    const selectorRef = React.useRef(selector);
    selectorRef.current = selector;
    const [snap, setSnap] = React.useState(() => selector(state));
    const snapRef = React.useRef(snap);

    React.useEffect(() => {
        const l = (s: any) => {
            const next = selectorRef.current(s);
            if (!shallowEqual(snapRef.current, next)) {
                snapRef.current = next;
                setSnap(next);
            }
        };
        listeners.add(l);
        return () => { listeners.delete(l); };
    }, []);
    return snap;
  };
  (useTTSStore as any).setState = setState;
  (useTTSStore as any).getState = () => state;
  return { useTTSStore };
});

vi.mock('../../../store/useToastStore', async () => {
  const React = await import('react');
  const shallowEqual = (objA: any, objB: any) => {
    if (Object.is(objA, objB)) return true;
    if (typeof objA !== 'object' || objA === null || typeof objB !== 'object' || objB === null) return false;
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);
    if (keysA.length !== keysB.length) return false;
    for (let i = 0; i < keysA.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(objB, keysA[i]) || !Object.is(objA[keysA[i]], objB[keysA[i]])) {
        return false;
      }
    }
    return true;
  };

  let state = { showToast: vi.fn() };
  const listeners = new Set<(s: any) => void>();

  const setState = (u: any) => { state = { ...state, ...u }; listeners.forEach(l => l(state)); };

  const useToastStore = (selector: any) => {
    const selectorRef = React.useRef(selector);
    selectorRef.current = selector;
    const [snap, setSnap] = React.useState(() => selector(state));
    const snapRef = React.useRef(snap);

    React.useEffect(() => {
        const l = (s: any) => {
            const next = selectorRef.current(s);
            if (!shallowEqual(snapRef.current, next)) {
                snapRef.current = next;
                setSnap(next);
            }
        };
        listeners.add(l);
        return () => { listeners.delete(l); };
    }, []);
    return snap;
  };
  (useToastStore as any).setState = setState;
  (useToastStore as any).getState = () => state;
  return { useToastStore };
});


describe('ReaderControlBar', () => {
  const resetStores = () => {
    (useReaderUIStore as any).setState({
      popover: { visible: false, text: '', cfiRange: '' },
      immersiveMode: false,
      currentBookId: null,
      currentSectionTitle: null,
      hidePopover: vi.fn(),
    });
    (useInventoryStore as any).setState({ books: {} });
    (useProgressStore as any).setState({ progress: {} });
    (useAnnotationStore as any).setState({ addAnnotation: vi.fn() });
    (useTTSStore as any).setState({ queue: [], isPlaying: false });
    (useToastStore as any).setState({ showToast: vi.fn() });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it('renders nothing when idle (no book, no audio, no annotations)', () => {
    const { container } = render(<ReaderControlBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders annotation variant when popover is visible', async () => {
    render(<ReaderControlBar />);

    act(() => {
      (useReaderUIStore as any).setState({
        popover: { visible: true, text: 'text', cfiRange: 'cfi' },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('compass-pill-annotation')).toBeInTheDocument();
    });
  });

  it('renders active variant when currentBookId is present (Reader Active)', async () => {
    render(<ReaderControlBar />);

    act(() => {
      (useReaderUIStore as any).setState({
        immersiveMode: false,
        currentBookId: '123',
        currentSectionTitle: 'Chapter 1',
        popover: { visible: false },
      });
      (useInventoryStore as any).setState({
        books: { '123': { bookId: '123', customTitle: 'Book 1' } }
      });
      (useProgressStore as any).setState({
        progress: { '123': { percentage: 0.5 } }
      });
    });

    await waitFor(() => {
      const pill = screen.getByTestId('compass-pill-active');
      expect(pill).toBeInTheDocument();
      expect(pill).toHaveAttribute('data-progress', '50');
    });
  });

  it('renders compact variant when immersive mode is on', async () => {
    render(<ReaderControlBar />);

    act(() => {
      (useReaderUIStore as any).setState({
        immersiveMode: true,
        currentBookId: '123',
        currentSectionTitle: 'Chapter 1',
        popover: { visible: false },
      });
      (useInventoryStore as any).setState({
        books: { '123': { bookId: '123', customTitle: 'Book 1' } }
      });
      (useProgressStore as any).setState({
        progress: { '123': { percentage: 0.75 } }
      });
    });

    await waitFor(() => {
      const pill = screen.getByTestId('compass-pill-compact');
      expect(pill).toBeInTheDocument();
      expect(pill).toHaveAttribute('data-progress', '75');
    });
  });

  it('renders summary variant when on home and has last read book', async () => {
    render(<ReaderControlBar />);

    act(() => {
      (useReaderUIStore as any).setState({
        currentBookId: null
      });
      (useInventoryStore as any).setState({
        books: { '1': { bookId: '1', customTitle: 'Book 1' } }
      });
      (useProgressStore as any).setState({
        progress: { '1': { percentage: 0.25, lastRead: 1000, bookId: '1' } }
      });
    });

    await waitFor(() => {
      const pill = screen.getByTestId('compass-pill-summary');
      expect(pill).toBeInTheDocument();
      expect(pill).toHaveAttribute('data-progress', '25');
    });
  });

  it('navigates to book when clicking summary pill', async () => {
    render(<ReaderControlBar />);

    act(() => {
      (useReaderUIStore as any).setState({
        currentBookId: null
      });
      (useInventoryStore as any).setState({
        books: { '1': { bookId: '1', customTitle: 'Book 1' } }
      });
      (useProgressStore as any).setState({
        progress: { '1': { percentage: 0.25, lastRead: 1000, bookId: '1' } }
      });
    });

    await waitFor(() => {
      const pill = screen.getByTestId('compass-pill-summary');
      fireEvent.click(pill);
    });

    expect(mockNavigate).toHaveBeenCalledWith('/read/1');
  });

  it('handles annotation actions', async () => {
    const spyAdd = vi.fn();
    const hidePopover = vi.fn();

    (useAnnotationStore as any).setState({ addAnnotation: spyAdd });
    (useReaderUIStore as any).setState({
        popover: { visible: true, text: 'selected text', cfiRange: 'cfi' },
        hidePopover,
        currentBookId: '123',
        immersiveMode: false
    });
    (useInventoryStore as any).setState({
        books: { '123': { bookId: '123', customTitle: 'Book 1' } }
    });

    render(<ReaderControlBar />);

    const btn = await screen.findByText('Color');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(spyAdd).toHaveBeenCalledWith(expect.objectContaining({
        type: 'highlight',
        color: 'yellow',
        bookId: '123'
      }));
    });
  });

  it('opens LexiconManager when pronounce action is triggered', async () => {
    const hidePopover = vi.fn();
    (useReaderUIStore as any).setState({
        popover: { visible: true, text: 'Desolate', cfiRange: 'cfi' },
        hidePopover,
        currentBookId: '123'
    });

    render(<ReaderControlBar />);

    const btn = await screen.findByText('Pronounce');
    fireEvent.click(btn);

    await waitFor(() => {
        expect(screen.getByTestId('lexicon-manager-mock')).toBeInTheDocument();
    });
    expect(screen.getByTestId('lexicon-manager-mock')).toHaveTextContent('Lexicon Manager Open: Desolate');
  });
});
