
import { describe, it } from 'vitest';
import { getPinyin, toTraditional, getPinyinSync, toTraditionalSync } from './ChineseTextProcessor';

describe('Performance benchmark', () => {
  it('measures getPinyin and toTraditional performance', async () => {
    const textNodes = Array.from({ length: 1000 }, () => "这是一个测试文本，包含一些汉字以进行拼音转换和繁简转换。");

    // Warm up and pre-load
    await toTraditional("");
    await getPinyin("");

    // Test Async first
    const startAsync = performance.now();
    for (const text of textNodes) {
      await toTraditional(text);
      await getPinyin(text);
    }
    const endAsync = performance.now();
    const asyncDuration = endAsync - startAsync;
    console.log(`[BENCHMARK] Asynchronous (1000 iterations) took: ${asyncDuration}ms`);

    // Test Sync
    const startSync = performance.now();
    for (const text of textNodes) {
      toTraditionalSync(text);
      getPinyinSync(text);
    }
    const endSync = performance.now();
    const syncDuration = endSync - startSync;
    console.log(`[BENCHMARK] Synchronous (1000 iterations) took: ${syncDuration}ms`);

    console.log(`[BENCHMARK] Improvement: ${((asyncDuration - syncDuration) / asyncDuration * 100).toFixed(2)}%`);
  });
});
