let openccInstance: unknown = null;
let pinyinModule: unknown = null;

export async function getOpenCC() {
  if (!openccInstance) {
    const OpenCC = await import('opencc-js');
    openccInstance = OpenCC.Converter({ from: 'cn', to: 'tw' });
  }
  return openccInstance;
}

export async function getPinyin(text: string): Promise<string[]> {
  if (!pinyinModule) {
    pinyinModule = await import('pinyin-pro');
  }
  return (pinyinModule as unknown as { pinyin: (text: string, options: unknown) => string[] }).pinyin(text, { type: 'array', toneType: 'symbol' });
}

export async function toTraditional(text: string): Promise<string> {
  const converter = await getOpenCC();
  return (converter as (t: string) => string)(text);
}
