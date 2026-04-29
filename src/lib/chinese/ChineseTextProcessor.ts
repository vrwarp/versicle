// eslint-disable-next-line @typescript-eslint/no-explicit-any
let openccInstance: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pinyinModule: any = null;

export async function ensureOpenCC() {
  if (!openccInstance) {
    // @ts-expect-error - no types for opencc-js
    const OpenCC = await import('opencc-js');
    openccInstance = OpenCC.Converter({ from: 'cn', to: 'tw' });
  }
  return openccInstance;
}

export async function ensurePinyin() {
  if (!pinyinModule) {
    pinyinModule = await import('pinyin-pro');
  }
  return pinyinModule;
}

export function getPinyin(text: string): string[] {
  if (!pinyinModule) {
    throw new Error('Pinyin module not loaded. Call ensurePinyin() first.');
  }
  return pinyinModule.pinyin(text, { type: 'array', toneType: 'symbol' });
}

export function toTraditional(text: string): string {
  if (!openccInstance) {
    throw new Error('OpenCC module not loaded. Call ensureOpenCC() first.');
  }
  return openccInstance(text);
}
