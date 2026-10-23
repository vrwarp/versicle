/**
 * localFetch guard tests: only same-origin / blob / data URLs are served;
 * anything that would leave the device is rejected before `fetch` runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localFetch } from './local';

describe('localFetch', () => {
  const fetchMock = vi.fn(async () => new Response('ok'));

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    '/books/alice.epub',
    'dict/cedict.json',
    'blob:http://localhost/1234',
    'data:text/plain;base64,AAAA',
    `${location.origin}/dict/cedict.json`,
  ])('serves local URL %s', async (url) => {
    await expect(localFetch(url)).resolves.toBeInstanceOf(Response);
    expect(fetchMock).toHaveBeenCalledWith(url, undefined);
  });

  describe('regression: protocol-relative URLs are cross-origin', () => {
    it.each([
      'https://evil.example/x',
      '//evil.example/x',
      '\\\\evil.example/x',
      '/\\evil.example/x',
      ' //evil.example/x',
    ])('rejects %s without fetching', async (url) => {
      await expect(localFetch(url)).rejects.toThrow(/localFetch only serves/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
