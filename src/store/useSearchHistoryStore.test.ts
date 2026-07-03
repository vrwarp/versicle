import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSearchHistoryStore } from './useSearchHistoryStore';

describe('useSearchHistoryStore', () => {
  beforeEach(() => {
    act(() => {
      useSearchHistoryStore.setState({
        recentQueries: [],
        savedQueries: [],
      });
    });
  });

  it('adds query to recentQueries and trims spacing', () => {
    const { result } = renderHook(() => useSearchHistoryStore());

    act(() => {
      result.current.addQuery('  test query  ');
    });

    expect(result.current.recentQueries).toHaveLength(1);
    expect(result.current.recentQueries[0].query).toBe('test query');
    expect(result.current.recentQueries[0].isSaved).toBe(false);
    expect(result.current.recentQueries[0].lastUsedAt).toBeGreaterThan(0);
  });

  it('updates timestamp and does not duplicate query in recentQueries', () => {
    const { result } = renderHook(() => useSearchHistoryStore());

    act(() => {
      result.current.addQuery('query1');
    });

    const firstTime = result.current.recentQueries[0].lastUsedAt;

    act(() => {
      result.current.addQuery('query1');
    });

    expect(result.current.recentQueries).toHaveLength(1);
    expect(result.current.recentQueries[0].lastUsedAt).toBeGreaterThanOrEqual(firstTime);
  });

  it('caps recentQueries at 20 items', () => {
    const { result } = renderHook(() => useSearchHistoryStore());

    act(() => {
      for (let i = 1; i <= 25; i++) {
        result.current.addQuery(`query${i}`);
      }
    });

    expect(result.current.recentQueries).toHaveLength(20);
    expect(result.current.recentQueries[0].query).toBe('query25');
    expect(result.current.recentQueries[19].query).toBe('query6');
  });

  it('toggles saved status (stars / unstars queries)', () => {
    const { result } = renderHook(() => useSearchHistoryStore());

    act(() => {
      result.current.addQuery('query1');
    });

    expect(result.current.recentQueries).toHaveLength(1);
    expect(result.current.savedQueries).toHaveLength(0);

    // Star
    act(() => {
      result.current.toggleSaved('query1');
    });

    expect(result.current.recentQueries).toHaveLength(0);
    expect(result.current.savedQueries).toHaveLength(1);
    expect(result.current.savedQueries[0].query).toBe('query1');
    expect(result.current.savedQueries[0].isSaved).toBe(true);

    // Unstar
    act(() => {
      result.current.toggleSaved('query1');
    });

    expect(result.current.savedQueries).toHaveLength(0);
    expect(result.current.recentQueries).toHaveLength(1);
    expect(result.current.recentQueries[0].query).toBe('query1');
    expect(result.current.recentQueries[0].isSaved).toBe(false);
  });

  it('deletes specific queries', () => {
    const { result } = renderHook(() => useSearchHistoryStore());

    act(() => {
      result.current.addQuery('query1');
      result.current.toggleSaved('query2');
    });

    expect(result.current.recentQueries).toHaveLength(1);
    expect(result.current.savedQueries).toHaveLength(1);

    act(() => {
      result.current.deleteQuery('query1');
    });

    expect(result.current.recentQueries).toHaveLength(0);
    expect(result.current.savedQueries).toHaveLength(1);

    act(() => {
      result.current.deleteQuery('query2');
    });

    expect(result.current.savedQueries).toHaveLength(0);
  });

  it('clears recentQueries but keeps savedQueries', () => {
    const { result } = renderHook(() => useSearchHistoryStore());

    act(() => {
      result.current.addQuery('query1');
      result.current.toggleSaved('query2');
    });

    expect(result.current.recentQueries).toHaveLength(1);
    expect(result.current.savedQueries).toHaveLength(1);

    act(() => {
      result.current.clearHistory();
    });

    expect(result.current.recentQueries).toHaveLength(0);
    expect(result.current.savedQueries).toHaveLength(1);
  });
});
