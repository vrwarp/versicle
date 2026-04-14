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
