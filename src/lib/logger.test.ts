import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLogger, getRecentLogs } from './logger';

afterEach(() => vi.restoreAllMocks());

describe('logger diagnostics ring', () => {
  it('records every level — printed or not — with args only for warn/error', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = createLogger('RingTest');

    log.debug('d', { big: 1 });
    log.info('i', { big: 1 });
    log.warn('w', { code: 'x' });
    log.error('e', Object.assign(new Error('nope'), { code: 'permission-denied' }));

    const mine = getRecentLogs().filter((r) => r.ns === 'RingTest');
    expect(mine.map((r) => [r.level, r.msg, r.args])).toEqual([
      ['debug', 'd', undefined],
      ['info', 'i', undefined],
      ['warn', 'w', '{"code":"x"}'],
      ['error', 'e', 'Error: nope (code=permission-denied)'],
    ]);
  });

  it('is bounded: the oldest records are overwritten first', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const log = createLogger('RingBound');
    for (let i = 0; i < 2100; i++) log.debug(`m${i}`);

    const all = getRecentLogs();
    expect(all).toHaveLength(2000);
    expect(all.at(-1)?.msg).toBe('m2099');
    expect(all[0].msg).toBe('m100');
  });
});
