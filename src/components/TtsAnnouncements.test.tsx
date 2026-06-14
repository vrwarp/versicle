/**
 * LiveAnnouncer + TTS announcement adapter (Phase 8 §D, a11y item 2):
 * playback STATE TRANSITIONS reach the persistent live regions; sentence
 * advances never do.
 */
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LiveAnnouncer } from './ui/LiveAnnouncer';
import { TtsAnnouncements } from './TtsAnnouncements';
import { announce } from '@kernel/locale/announcer';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { makeTTSQueue } from '@test/harness';

function flushAnnouncementFrame() {
  // LiveAnnouncer writes on the next animation frame.
  act(() => {
    vi.advanceTimersByTime(20);
  });
}

describe('LiveAnnouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders PERSISTENT polite + assertive regions and injects announcement text', () => {
    render(<LiveAnnouncer />);
    expect(screen.getByTestId('live-announcer-polite')).toBeInTheDocument();
    expect(screen.getByTestId('live-announcer-assertive')).toBeInTheDocument();

    act(() => announce('Paused'));
    flushAnnouncementFrame();
    expect(screen.getByTestId('live-announcer-polite')).toHaveTextContent('Paused');
    expect(screen.getByTestId('live-announcer-assertive')).toHaveTextContent('');

    act(() => announce('Something broke', { assertive: true }));
    flushAnnouncementFrame();
    expect(screen.getByTestId('live-announcer-assertive')).toHaveTextContent('Something broke');
  });

  it('resolves keyed announcements through the catalog', () => {
    render(<LiveAnnouncer />);
    act(() => announce({ key: 'announce.tts.playing', params: { section: 'Chapter 3' } }));
    flushAnnouncementFrame();
    expect(screen.getByTestId('live-announcer-polite')).toHaveTextContent('Playing — Chapter 3');
  });
});

describe('TtsAnnouncements (adapter: playback transitions → announcements)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    useTTSPlaybackStore.setState({ status: 'stopped', queue: [], currentIndex: 0 });
    useReaderUIStore.setState({ currentSectionTitle: 'Chapter 1' });
  });
  afterEach(() => {
    useTTSPlaybackStore.setState({ status: 'stopped', queue: [], currentIndex: 0 });
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const renderAdapter = () =>
    render(
      <>
        <LiveAnnouncer />
        <TtsAnnouncements />
      </>,
    );

  it('announces Playing — {section} / Paused / Stopped on status transitions', () => {
    renderAdapter();
    const polite = () => screen.getByTestId('live-announcer-polite');

    act(() => { useTTSPlaybackStore.setState({ status: 'playing' }); });
    flushAnnouncementFrame();
    expect(polite()).toHaveTextContent('Playing — Chapter 1');

    act(() => { useTTSPlaybackStore.setState({ status: 'paused' }); });
    flushAnnouncementFrame();
    expect(polite()).toHaveTextContent('Paused');

    act(() => { useTTSPlaybackStore.setState({ status: 'stopped' }); });
    flushAnnouncementFrame();
    expect(polite()).toHaveTextContent('Stopped');
  });

  it('NEVER announces per-sentence: queue advances leave the regions untouched (a11y item 2)', () => {
    renderAdapter();
    act(() => { useTTSPlaybackStore.setState({ status: 'playing', queue: makeTTSQueue(5) }); });
    flushAnnouncementFrame();
    const before = screen.getByTestId('live-announcer-polite').textContent;

    for (let i = 1; i < 5; i++) {
      act(() => {
        useTTSPlaybackStore.setState({ currentIndex: i, activeCfi: `cfi-${i}` });
      });
    }
    flushAnnouncementFrame();
    expect(screen.getByTestId('live-announcer-polite').textContent).toBe(before);
  });

  it('announces section changes while playing, DEBOUNCED', () => {
    renderAdapter();
    act(() => { useTTSPlaybackStore.setState({ status: 'playing' }); });
    flushAnnouncementFrame();

    // Rapid section flips: only the settled value announces, once.
    act(() => { useReaderUIStore.setState({ currentSectionTitle: 'Chapter 2' }); });
    act(() => { useReaderUIStore.setState({ currentSectionTitle: 'Chapter 3' }); });
    act(() => { vi.advanceTimersByTime(999); });
    expect(screen.getByTestId('live-announcer-polite')).not.toHaveTextContent('Chapter 3');

    act(() => { vi.advanceTimersByTime(2); });
    flushAnnouncementFrame();
    expect(screen.getByTestId('live-announcer-polite')).toHaveTextContent('Playing — Chapter 3');
  });

  it('stays silent on section changes while stopped (user browsing visually)', () => {
    renderAdapter();
    act(() => { useReaderUIStore.setState({ currentSectionTitle: 'Chapter 9' }); });
    act(() => { vi.advanceTimersByTime(2000); });
    flushAnnouncementFrame();
    expect(screen.getByTestId('live-announcer-polite')).toHaveTextContent('');
  });
});
