import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReaderControlBar } from '../ReaderControlBar';

// Helper for shallow comparison (Inlined in mocks)
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

// Hoisted stores
const {
  readerStore,
  inventoryStore,
  progressStore,
  annotationStore,
  ttsStore,
  toastStore
} = vi.hoisted(() => {
  const createStore = (initialState: any) => {
    let state = { ...initialState };
    const listeners = new Set<(s: any) => void>();
    return {
      getState: () => state,
      setState: (partial: any) => { state = { ...state, ...partial }; listeners.forEach(l => l(state)); },
      listeners
    };
  };

  const readerStore = createStore({
      popover: { visible: false, text: '', cfiRange: '' },
      hidePopover: vi.fn(),
      immersiveMode: false,
      currentBookId: null,
      currentSectionTitle: null
  });
  const inventoryStore = createStore({ books: {} });
  const progressStore = createStore({ progress: {} });
  const annotationStore = createStore({ addAnnotation: vi.fn() });
  const ttsStore = createStore({ queue: [], isPlaying: false, play: vi.fn() });
  const toastStore = createStore({ showToast: vi.fn() });

  return {
    readerStore,
    inventoryStore,
    progressStore,
    annotationStore,
    ttsStore,
    toastStore
  };
});

// Inline Mock Implementations for Stores with stable ref updates

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

  return {
    useReaderUIStore: (selector: any) => {
        const selectorRef = React.useRef(selector);
        selectorRef.current = selector;
        const [val, setVal] = React.useState(() => selector(readerStore.getState()));
        const valRef = React.useRef(val);

        React.useEffect(() => {
            const cb = () => {
                const next = selectorRef.current(readerStore.getState());
                if (!shallowEqual(valRef.current, next)) {
                    valRef.current = next;
                    setVal(next);
                }
            };
            readerStore.listeners.add(cb);
            return () => readerStore.listeners.delete(cb);
        }, []);
        return val;
    }
  };
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
  return {
    useInventoryStore: (selector: any) => {
        const selectorRef = React.useRef(selector);
        selectorRef.current = selector;
        const [val, setVal] = React.useState(() => selector(inventoryStore.getState()));
        const valRef = React.useRef(val);
        React.useEffect(() => {
            const cb = () => {
                const next = selectorRef.current(inventoryStore.getState());
                if (!shallowEqual(valRef.current, next)) {
                    valRef.current = next;
                    setVal(next);
                }
            };
            inventoryStore.listeners.add(cb);
            return () => inventoryStore.listeners.delete(cb);
        }, []);
        return val;
    }
  };
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
  return {
    useProgressStore: (selector: any) => {
        const selectorRef = React.useRef(selector);
        selectorRef.current = selector;
        const [val, setVal] = React.useState(() => selector(progressStore.getState()));
        const valRef = React.useRef(val);
        React.useEffect(() => {
            const cb = () => {
                const next = selectorRef.current(progressStore.getState());
                if (!shallowEqual(valRef.current, next)) {
                    valRef.current = next;
                    setVal(next);
                }
            };
            progressStore.listeners.add(cb);
            return () => progressStore.listeners.delete(cb);
        }, []);
        return val;
    }
  };
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
  return {
    useAnnotationStore: (selector: any) => {
        const selectorRef = React.useRef(selector);
        selectorRef.current = selector;
        const [val, setVal] = React.useState(() => selector(annotationStore.getState()));
        const valRef = React.useRef(val);
        React.useEffect(() => {
            const cb = () => {
                const next = selectorRef.current(annotationStore.getState());
                if (!shallowEqual(valRef.current, next)) {
                    valRef.current = next;
                    setVal(next);
                }
            };
            annotationStore.listeners.add(cb);
            return () => annotationStore.listeners.delete(cb);
        }, []);
        return val;
    }
  };
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
  return {
    useTTSStore: (selector: any) => {
        const selectorRef = React.useRef(selector);
        selectorRef.current = selector;
        const [val, setVal] = React.useState(() => selector(ttsStore.getState()));
        const valRef = React.useRef(val);
        React.useEffect(() => {
            const cb = () => {
                const next = selectorRef.current(ttsStore.getState());
                if (!shallowEqual(valRef.current, next)) {
                    valRef.current = next;
                    setVal(next);
                }
            };
            ttsStore.listeners.add(cb);
            return () => ttsStore.listeners.delete(cb);
        }, []);
        return val;
    }
  };
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
  return {
    useToastStore: (selector: any) => {
        const selectorRef = React.useRef(selector);
        selectorRef.current = selector;
        const [val, setVal] = React.useState(() => selector(toastStore.getState()));
        const valRef = React.useRef(val);
        React.useEffect(() => {
            const cb = () => {
                const next = selectorRef.current(toastStore.getState());
                if (!shallowEqual(valRef.current, next)) {
                    valRef.current = next;
                    setVal(next);
                }
            };
            toastStore.listeners.add(cb);
            return () => toastStore.listeners.delete(cb);
        }, []);
        return val;
    }
  };
});

const mockUseNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockUseNavigate,
}));

vi.mock('zustand/react/shallow', () => ({
  useShallow: (selector: any) => selector
}));

// Mock LexiconManager
vi.mock('./LexiconManager', () => ({
  LexiconManager: ({ open, onOpenChange, initialTerm }: any) => (
    open ? (
      <div data-testid="lexicon-manager-mock">
        Lexicon Manager Open: {initialTerm}
        <button onClick={() => onOpenChange(false)}>Close</button>
      </div>
    ) : <div data-testid="lexicon-manager-closed" />
  )
}));

// Mock CompassPill
vi.mock('../ui/CompassPill', () => ({
  CompassPill: ({ variant, onClick, onAnnotationAction, progress }: any) => (
    <div data-testid={`compass-pill-${variant}`} data-progress={progress} onClick={onClick}>
      {variant}
      <button onClick={() => onAnnotationAction && onAnnotationAction('color', 'yellow')}>Color</button>
      <button onClick={() => onAnnotationAction && onAnnotationAction('pronounce')}>Pronounce</button>
    </div>
  ),
  ActionType: {}
}));

describe('ReaderControlBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset store states
    readerStore.setState({
      popover: { visible: false, text: '', cfiRange: '' },
      immersiveMode: false,
      currentBookId: null,
      currentSectionTitle: null,
      hidePopover: vi.fn(),
    });
    inventoryStore.setState({ books: {} });
    progressStore.setState({ progress: {} });
    annotationStore.setState({ addAnnotation: vi.fn() });
    ttsStore.setState({ queue: [], isPlaying: false });
  });

  it('renders nothing when idle (no book, no audio, no annotations)', () => {
    const { container } = render(<ReaderControlBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders annotation variant when popover is visible', async () => {
    render(<ReaderControlBar />);

    React.act(() => {
      readerStore.setState({
        popover: { visible: true, text: 'text', cfiRange: 'cfi' },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('compass-pill-annotation')).toBeInTheDocument();
    });
  });

  it('renders active variant when currentBookId is present (Reader Active)', async () => {
    render(<ReaderControlBar />);

    React.act(() => {
      readerStore.setState({
        immersiveMode: false,
        currentBookId: '123',
        currentSectionTitle: 'Chapter 1',
        popover: { visible: false },
      });
      inventoryStore.setState({
        books: { '123': { bookId: '123', customTitle: 'Book 1' } }
      });
      progressStore.setState({
        progress: { '123': { percentage: 0.5 } }
      });
    });

    await waitFor(() => {
      const pill = screen.getByTestId('compass-pill-active');
      expect(pill).toBeInTheDocument();
      // Ensure progress is treated as string for attribute check
      expect(pill).toHaveAttribute('data-progress', '50');
    });
  });

  it('renders compact variant when immersive mode is on', async () => {
    render(<ReaderControlBar />);

    React.act(() => {
      readerStore.setState({
        immersiveMode: true,
        currentBookId: '123',
        currentSectionTitle: 'Chapter 1',
        popover: { visible: false },
      });
      inventoryStore.setState({
        books: { '123': { bookId: '123', customTitle: 'Book 1' } }
      });
      progressStore.setState({
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

    React.act(() => {
      readerStore.setState({
        currentBookId: null
      });
      inventoryStore.setState({
        books: { '1': { bookId: '1', customTitle: 'Book 1' } }
      });
      progressStore.setState({
        progress: { '1': { percentage: 0.25, lastRead: 1000 } }
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

    React.act(() => {
      readerStore.setState({
        currentBookId: null
      });
      inventoryStore.setState({
        books: { '1': { bookId: '1', customTitle: 'Book 1' } }
      });
      progressStore.setState({
        progress: { '1': { percentage: 0.25, lastRead: 1000 } }
      });
    });

    await waitFor(() => {
      const pill = screen.getByTestId('compass-pill-summary');
      fireEvent.click(pill);
    });

    expect(mockUseNavigate).toHaveBeenCalledWith('/read/1');
  });

  it('handles annotation actions', async () => {
    const spyAdd = vi.fn();
    const hidePopover = vi.fn();

    render(<ReaderControlBar />);

    React.act(() => {
      readerStore.setState({
        popover: { visible: true, text: 'selected text', cfiRange: 'cfi' },
        hidePopover,
        currentBookId: '123',
        immersiveMode: false
      });
      annotationStore.setState({ addAnnotation: spyAdd });
      inventoryStore.setState({
        books: { '123': { bookId: '123', customTitle: 'Book 1' } }
      });
    });

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
    render(<ReaderControlBar />);

    React.act(() => {
      readerStore.setState({
        popover: { visible: true, text: 'Desolate', cfiRange: 'cfi' },
        hidePopover,
        currentBookId: '123'
      });
    });

    const btn = await screen.findByText('Pronounce');
    fireEvent.click(btn);

    await waitFor(() => {
        expect(screen.getByTestId('lexicon-manager-mock')).toBeInTheDocument();
    });
    expect(screen.getByTestId('lexicon-manager-mock')).toHaveTextContent('Lexicon Manager Open: Desolate');
  });
});
