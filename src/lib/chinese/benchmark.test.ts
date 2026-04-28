
import { describe, it } from 'vitest';
import { getPinyin, toTraditional, ensurePinyin, ensureOpenCC } from './ChineseTextProcessor';

describe('Performance benchmark', () => {
  it('measures getPinyin and toTraditional performance', async () => {
    const textNodes = Array.from({ length: 1000 }, () => "这是一个测试文本，包含一些汉字以进行拼音转换和繁简转换。");

    // Warm up and pre-load
    await ensureOpenCC();
    await ensurePinyin();

    // Test Sync
    const startSync = performance.now();
    for (const text of textNodes) {
      toTraditional(text);
      getPinyin(text);
    }
    const endSync = performance.now();
    const syncDuration = endSync - startSync;
    console.log(`[BENCHMARK] Synchronous (1000 iterations) took: ${syncDuration}ms`);
  });
});
