// eslint-disable-next-line @typescript-eslint/no-explicit-any
let openccInstance: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pinyinModule: any = null;

export async function getOpenCC() {
  if (!openccInstance) {
    // @ts-expect-error - no types for opencc-js
    const OpenCC = await import('opencc-js');
    openccInstance = OpenCC.Converter({ from: 'cn', to: 'tw' });
  }
  return openccInstance;
}

export async function getPinyin(text: string): Promise<string[]> {
  if (!pinyinModule) {
    pinyinModule = await import('pinyin-pro');
  }
  return pinyinModule.pinyin(text, { type: 'array', toneType: 'symbol' });
}

export async function toTraditional(text: string): Promise<string> {
  const converter = await getOpenCC();
  return converter(text);
}

export function getPinyinSync(text: string): string[] {
  if (!pinyinModule) {
    throw new Error('Pinyin module not loaded. Call getPinyin() first.');
  }
  return pinyinModule.pinyin(text, { type: 'array', toneType: 'symbol' });
}

export function toTraditionalSync(text: string): string {
  if (!openccInstance) {
    throw new Error('OpenCC module not loaded. Call getOpenCC() or toTraditional() first.');
  }
  return openccInstance(text);
}
