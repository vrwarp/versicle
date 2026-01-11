
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReaderControlBar } from '../ReaderControlBar';

// Helper for reactive mock store state
const createReactiveStore = (initialState: any) => {
  let state = { ...initialState };
  const listeners = new Set<(s: any) => void>();

  const getState = () => state;
  const setState = (partial: any) => {
    state = { ...state, ...partial };
    listeners.forEach(l => l(state));
  };
  const subscribe = (l: (s: any) => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };

  return { getState, setState, subscribe, listeners, state }; // expose internals for hook
};

// Hoisted stores must be created via vi.hoisted to be available in mocks
const {
  readerStore,
  inventoryStore,
  progressStore,
  annotationStore,
  ttsStore,
  toastStore
} = vi.hoisted(() => {

  // We duplicate the helper here because hoisted block is isolated
  const createStore = (initialState: any) => {
    let state = { ...initialState };
    const listeners = new Set<(s: any) => void>();
    return {
      getState: () => state,
      setState: (partial: any) => { state = { ...state, ...partial }; listeners.forEach(l => l(state)); },
      listeners
    };
  };

  return {
    readerStore: createStore({
      popover: { visible: false, text: '', cfiRange: '' },
      hidePopover: vi.fn(),
      immersiveMode: false,
      currentBookId: null,
      currentSectionTitle: null
    }),
    inventoryStore: createStore({ books: {} }),
    progressStore: createStore({ progress: {} }),
    annotationStore: createStore({ addAnnotation: vi.fn() }),
    ttsStore: createStore({ queue: [], isPlaying: false, play: vi.fn() }),
    toastStore: createStore({ showToast: vi.fn() })
  };
});

// Mock implementations reusing the hoisted state
const createMockHook = (store: any) => async () => {
  const React = await import('react');
  return {
    // Dynamic export name based on usage, but we return object with default or named export
  };
};

// Generic hook implementation
const mockHookImpl = (store: any) => (selector?: any) => {
  const React = require('react'); // specific for vitest environment or use dynamic import inside factory if strictly ESM
  // But since we are likely in JSDOM/Node setup, require matches.
  // However, explicit async import in factory is safer.

  // Fallback if selector is missing
  const [snap, setSnap] = React.useState(() => selector ? selector(store.getState()) : store.getState());

  React.useEffect(() => {
    const listener = (newState: any) => {
      setSnap(selector ? selector(newState) : newState);
    };
    store.listeners.add(listener);
    return () => store.listeners.delete(listener);
  }, [selector]);

  return snap;
};

vi.mock('../../../store/useReaderUIStore', async () => {
  const React = await import('react');
  return {
    useReaderUIStore: (selector: any) => {
      const [snap, setSnap] = React.useState(() => selector ? selector(readerStore.getState()) : readerStore.getState());
      React.useEffect(() => {
        const listener = (newState: any) => {
          setSnap(selector ? selector(newState) : newState);
        };
        readerStore.listeners.add(listener);
        return () => readerStore.listeners.delete(listener);
      }, [selector]);
      return snap;
    }
  };
});

vi.mock('../../../store/useInventoryStore', async () => {
  const React = await import('react');
  return {
    useInventoryStore: (selector: any) => {
      const [snap, setSnap] = React.useState(() => selector ? selector(inventoryStore.getState()) : inventoryStore.getState());
      React.useEffect(() => {
        const listener = (newState: any) => {
          setSnap(selector ? selector(newState) : newState);
        };
        inventoryStore.listeners.add(listener);
        return () => inventoryStore.listeners.delete(listener);
      }, [selector]);
      return snap;
    }
  };
});

vi.mock('../../../store/useProgressStore', async () => {
  const React = await import('react');
  return {
    useProgressStore: (selector: any) => {
      const [snap, setSnap] = React.useState(() => selector ? selector(progressStore.getState()) : progressStore.getState());
      React.useEffect(() => {
        const listener = (newState: any) => {
          setSnap(selector ? selector(newState) : newState);
        };
        progressStore.listeners.add(listener);
        return () => progressStore.listeners.delete(listener);
      }, [selector]);
      return snap;
    }
  };
});

vi.mock('../../../store/useAnnotationStore', async () => {
  const React = await import('react');
  return {
    useAnnotationStore: (selector: any) => {
      const [snap, setSnap] = React.useState(() => selector ? selector(annotationStore.getState()) : annotationStore.getState());
      React.useEffect(() => {
        const listener = (newState: any) => {
          setSnap(selector ? selector(newState) : newState);
        };
        annotationStore.listeners.add(listener);
        return () => annotationStore.listeners.delete(listener);
      }, [selector]);
      return snap;
    }
  };
});

vi.mock('../../../store/useTTSStore', async () => {
  const React = await import('react');
  return {
    useTTSStore: (selector: any) => {
      const [snap, setSnap] = React.useState(() => selector ? selector(ttsStore.getState()) : ttsStore.getState());
      React.useEffect(() => {
        const listener = (newState: any) => {
          setSnap(selector ? selector(newState) : newState);
        };
        ttsStore.listeners.add(listener);
        return () => ttsStore.listeners.delete(listener);
      }, [selector]);
      return snap;
    }
  };
});

vi.mock('../../../store/useToastStore', async () => {
  const React = await import('react');
  return {
    useToastStore: (selector: any) => {
      const [snap, setSnap] = React.useState(() => selector ? selector(toastStore.getState()) : toastStore.getState());
      React.useEffect(() => {
        const listener = (newState: any) => {
          setSnap(selector ? selector(newState) : newState);
        };
        toastStore.listeners.add(listener);
        return () => toastStore.listeners.delete(listener);
      }, [selector]);
      return snap;
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

// Mock LexiconManager (src/components/reader/LexiconManager)
vi.mock('./LexiconManager', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  LexiconManager: ({ open, onOpenChange, initialTerm }: any) => (
    open ? (
      <div data-testid="lexicon-manager-mock">
        Lexicon Manager Open: {initialTerm}
        <button onClick={() => onOpenChange(false)}>Close</button>
      </div>
    ) : <div data-testid="lexicon-manager-closed" />
  )
}));

// Mock CompassPill (src/components/ui/CompassPill)
vi.mock('../ui/CompassPill', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // Update state after render to test reactivity
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

    // Test Color Action (via mocked button)
    const btn = await screen.findByText('Color');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(spyAdd).toHaveBeenCalledWith({
        type: 'highlight',
        color: 'yellow',
        bookId: '123',
        text: 'selected text',
        cfiRange: 'cfi'
      });
      expect(hidePopover).toHaveBeenCalled();
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

    expect(screen.queryByTestId('lexicon-manager-mock')).not.toBeInTheDocument();

    const btn = await screen.findByText('Pronounce');
    fireEvent.click(btn);

    expect(screen.getByTestId('lexicon-manager-mock')).toBeInTheDocument();
    expect(screen.getByTestId('lexicon-manager-mock')).toHaveTextContent('Lexicon Manager Open: Desolate');
    expect(hidePopover).toHaveBeenCalled();
  });
});
