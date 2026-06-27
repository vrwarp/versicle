/**
 * polyphonic — a curated contextual-reading override for Chinese 多音字
 * (polyphonic characters), layered on top of pinyin-pro's per-character
 * output in {@link getPinyin}.
 *
 * WHY THIS EXISTS
 * pinyin-pro segments a sentence and picks a reading per word, which already
 * resolves the COMMON polyphonic cases (银行→háng, 重生→chóng, 长久→cháng).
 * But its built-in phrase dictionary leaves a long tail wrong — measured
 * against the reference rule set, it mis-reads e.g. 圣乐 (lè→yuè),
 * 行传 (chuán→zhuàn), 受难 (nán→nàn), 朝露 (cháo→zhāo), 圣都 (dōu→dū),
 * 受创 (chuàng→chuāng), 和面 (hé→huó), 教书 (jiào→jiāo), 夹杂 (jiā→jiá),
 * 你得 (dé→děi). Those are exactly the readings the overlay annotates above
 * each glyph, so the wrong tone/syllable is visible to the reader.
 *
 * APPROACH (ported from vrwarp/ruby-font-creator's src/polyphonic.ts)
 * The reference project bakes the same rules into an OpenType `calt` GSUB
 * table because a font cannot run a segmenter at render time. Versicle runs
 * pinyin-pro at render time, so the SAME curated data is applied directly:
 * each entry names a polyphonic character and, per alternate reading, the
 * context WORDS (2–3 char, the bigram equivalents) that select it. When a
 * context word is found in the text, the matched character's reading is
 * overridden. Trigger words carry both Simplified and Traditional forms, and
 * Traditional-only characters (樂, 傳, 長…) get their own entries, so the
 * override fires the same in either display script.
 *
 * Faithful to the reference's tradeoff: matching is by context word, so a
 * trigger that is a substring of a larger word it does not belong to can
 * mis-fire (the GSUB bigram rules have the identical limitation). The curated
 * words are common enough that this is rare in practice.
 */

export interface PolyphonicAlternate {
  /** The reading to force, in tone-symbol form (matches pinyin-pro `toneType: 'symbol'`). */
  reading: string;
  /** Context words that select this reading; each contains the entry's character. */
  words: string[];
}

export interface PolyphonicEntry {
  /** The polyphonic character. */
  char: string;
  /** Its default reading (documentation/validation only — never forced). */
  base: string;
  alternates: PolyphonicAlternate[];
}

/**
 * Curated polyphonic rules (ported verbatim from ruby-font-creator). General
 * Chinese plus the religious/worship vocabulary the reference targets; both
 * Simplified and Traditional forms are covered.
 */
export const POLYPHONIC_ENTRIES: readonly PolyphonicEntry[] = [
  { char: '行', base: 'xíng', alternates: [{ reading: 'háng', words: ['银行', '銀行', '行业', '行業', '行列', '内行', '內行', '外行', '行家', '行距'] }] },
  { char: '重', base: 'zhòng', alternates: [{ reading: 'chóng', words: ['重生', '重新', '重来', '重來', '重建', '重复', '重複', '重叠', '重疊'] }] },
  { char: '乐', base: 'lè', alternates: [{ reading: 'yuè', words: ['音乐', '圣乐', '乐器', '诗乐'] }] },
  { char: '传', base: 'chuán', alternates: [{ reading: 'zhuàn', words: ['行传'] }] },
  { char: '长', base: 'zhǎng', alternates: [{ reading: 'cháng', words: ['长久', '长存', '长远', '长时', '长期', '很长', '极长', '特长', '细长'] }] },
  { char: '难', base: 'nán', alternates: [{ reading: 'nàn', words: ['患难', '苦难', '受难', '灾难', '难民', '遇难'] }] },
  { char: '朝', base: 'cháo', alternates: [{ reading: 'zhāo', words: ['朝露', '朝早'] }] },
  { char: '兴', base: 'xìng', alternates: [{ reading: 'xīng', words: ['复兴', '兴起', '兴盛', '兴旺', '振兴'] }] },
  { char: '应', base: 'yīng', alternates: [{ reading: 'yìng', words: ['回应', '应验', '响应', '感应'] }] },
  { char: '尽', base: 'jìn', alternates: [{ reading: 'jìn', words: ['尽心', '尽性', '尽意', '尽力', '用尽', '竭尽'] }] },
  { char: '调', base: 'diào', alternates: [{ reading: 'tiáo', words: ['调和', '调节', '调整'] }] },
  { char: '还', base: 'hái', alternates: [{ reading: 'huán', words: ['还债', '归还', '还给', '退还', '偿还', '还手', '还书', '还原', '还乡'] }] },
  { char: '好', base: 'hǎo', alternates: [{ reading: 'hào', words: ['爱好', '愛好', '好学', '好學', '好奇'] }] },
  { char: '都', base: 'dōu', alternates: [{ reading: 'dū', words: ['圣都', '聖都', '首都', '都市'] }] },
  { char: '为', base: 'wèi', alternates: [{ reading: 'wéi', words: ['成为', '行为', '作为', '称为', '视为', '以为', '认为'] }] },
  { char: '处', base: 'chù', alternates: [{ reading: 'chǔ', words: ['处理', '处置', '处境'] }] },
  { char: '樂', base: 'lè', alternates: [{ reading: 'yuè', words: ['音樂', '聖樂', '樂器', '詩樂'] }] },
  { char: '傳', base: 'chuán', alternates: [{ reading: 'zhuàn', words: ['行傳'] }] },
  { char: '長', base: 'zhǎng', alternates: [{ reading: 'cháng', words: ['長久', '長存', '長遠', '長時', '長期', '很長', '極長', '特長', '細長'] }] },
  { char: '難', base: 'nán', alternates: [{ reading: 'nàn', words: ['患難', '苦難', '受難', '災難', '難民', '遇難'] }] },
  { char: '興', base: 'xìng', alternates: [{ reading: 'xīng', words: ['復興', '興起', '興盛', '興旺', '振興'] }] },
  { char: '應', base: 'yīng', alternates: [{ reading: 'yìng', words: ['回應', '應驗', '響應', '感應'] }] },
  { char: '盡', base: 'jìn', alternates: [{ reading: 'jìn', words: ['盡心', '盡性', '盡意', '盡力', '用盡', '竭盡'] }] },
  { char: '調', base: 'diào', alternates: [{ reading: 'tiáo', words: ['調和', '調節', '調整'] }] },
  { char: '還', base: 'hái', alternates: [{ reading: 'huán', words: ['還債', '歸還', '還給', '退還', '償還', '還手', '還書', '還原', '還鄉'] }] },
  { char: '為', base: 'wèi', alternates: [{ reading: 'wéi', words: ['成為', '行為', '作為', '稱為', '視為', '以為', '認為'] }] },
  { char: '處', base: 'chù', alternates: [{ reading: 'chǔ', words: ['處理', '處置', '處境'] }] },
  { char: '降', base: 'jiàng', alternates: [{ reading: 'xiáng', words: ['投降'] }] },
  { char: '恶', base: 'è', alternates: [{ reading: 'wù', words: ['厌恶', '可恶', '恶恶'] }] },
  { char: '惡', base: 'è', alternates: [{ reading: 'wù', words: ['厭惡', '可惡', '惡惡'] }] },
  { char: '弹', base: 'tán', alternates: [{ reading: 'dàn', words: ['子弹'] }] },
  { char: '彈', base: 'tán', alternates: [{ reading: 'dàn', words: ['子彈'] }] },
  { char: '创', base: 'chuàng', alternates: [{ reading: 'chuāng', words: ['创伤', '受创'] }] },
  { char: '創', base: 'chuàng', alternates: [{ reading: 'chuāng', words: ['創傷', '受創'] }] },
  { char: '和', base: 'hé', alternates: [
    { reading: 'hè', words: ['附和', '唱和'] },
    { reading: 'huò', words: ['和泥'] },
    { reading: 'huó', words: ['和面', '和麵'] },
    { reading: 'hú', words: ['和牌', '和了'] },
  ] },
  { char: '差', base: 'chà', alternates: [
    { reading: 'chāi', words: ['出差', '差事', '公差', '邮差', '郵差'] },
    { reading: 'chā', words: ['误差', '誤差', '偏差', '时差', '時差', '极差', '極差', '差别', '差別', '差异', '差異', '差错', '差錯'] },
    { reading: 'cī', words: ['参差', '參差'] },
  ] },
  { char: '觉', base: 'jué', alternates: [{ reading: 'jiào', words: ['睡觉'] }] },
  { char: '覺', base: 'jué', alternates: [{ reading: 'jiào', words: ['睡覺'] }] },
  { char: '大', base: 'dà', alternates: [{ reading: 'dài', words: ['大夫'] }] },
  { char: '担', base: 'dān', alternates: [{ reading: 'dàn', words: ['重担'] }] },
  { char: '擔', base: 'dān', alternates: [{ reading: 'dàn', words: ['重擔'] }] },
  { char: '教', base: 'jiào', alternates: [{ reading: 'jiāo', words: ['教书', '教書'] }] },
  { char: '倒', base: 'dào', alternates: [{ reading: 'dǎo', words: ['倒在', '倒下', '碰倒', '跌倒', '摔倒', '打倒'] }] },
  { char: '地', base: 'de', alternates: [{ reading: 'dì', words: ['地上', '地下', '地方', '地球', '地图', '地圖', '地址', '地狱', '地獄', '地位', '地带', '地帶', '地步', '地表', '地势', '地勢', '地契', '土地', '各地', '大地', '墓地', '目的地', '圣地', '聖地', '盆地', '草地', '平地', '林地'] }] },
  { char: '夹', base: 'jiā', alternates: [{ reading: 'jiá', words: ['夹杂', '夹克', '夹衣', '夹道', '夹攻'] }] },
  { char: '夾', base: 'jiā', alternates: [{ reading: 'jiá', words: ['夾雜', '夾克', '夾衣', '夾道', '夾攻'] }] },
  { char: '得', base: 'de', alternates: [
    { reading: 'de', words: ['觉得', '覺得', '变得', '變得', '高兴得', '高興得', '得很', '看得到', '听得到', '聽得到', '来得及', '來得及', '看得見', '看得见', '出得去', '进得来', '進得來', '吃得完', '做得到'] },
    { reading: 'děi', words: ['你得', '他得', '我得', '们得', '們得', '谁得', '誰得', '都得', '总得', '總得', '非得', '不得不'] },
  ] },
  { char: '着', base: 'zhe', alternates: [
    { reading: 'zháo', words: ['睡着', '着凉', '着火', '着急', '着迷'] },
    { reading: 'zhāo', words: ['一着', '着数', '着數'] },
  ] },
  { char: '著', base: 'zhe', alternates: [
    { reading: 'zháo', words: ['睡著', '著涼', '著火', '著急', '著迷'] },
    { reading: 'zhāo', words: ['一著', '著数', '著數'] },
  ] },
  { char: '参', base: 'shēn', alternates: [{ reading: 'cēn', words: ['参差'] }] },
  { char: '參', base: 'shēn', alternates: [{ reading: 'cēn', words: ['參差'] }] },
];

/** word → (code-point index within the word → forced reading). */
type WordOverrides = Map<number, string>;

let lookup: Map<string, WordOverrides> | null = null;
let maxWordCodePoints = 0;

/**
 * Build (once) the context-word lookup from {@link POLYPHONIC_ENTRIES}.
 * For each trigger word, the FIRST occurrence of the entry's character is the
 * position overridden — so a word with the character twice (恶恶 = wù'è) only
 * forces the leading one, leaving the rest to pinyin-pro. Entries that share a
 * trigger word (参差 forces both 参→cēn and 差→cī) merge their positions.
 */
function buildLookup(): Map<string, WordOverrides> {
  const map = new Map<string, WordOverrides>();
  for (const entry of POLYPHONIC_ENTRIES) {
    for (const alt of entry.alternates) {
      for (const word of alt.words) {
        const wordCps = Array.from(word);
        const index = wordCps.indexOf(entry.char);
        if (index < 0) continue; // defensive: word must contain the character
        maxWordCodePoints = Math.max(maxWordCodePoints, wordCps.length);
        let overrides = map.get(word);
        if (!overrides) {
          overrides = new Map<number, string>();
          map.set(word, overrides);
        }
        overrides.set(index, alt.reading);
      }
    }
  }
  return map;
}

function getLookup(): Map<string, WordOverrides> {
  if (!lookup) lookup = buildLookup();
  return lookup;
}

/**
 * Apply the curated polyphonic overrides to a per-code-point `pinyinArray`
 * (as produced by pinyin-pro for `text`). Returns a new array; the input is
 * not mutated. `pinyinArray` MUST be aligned one entry per code point of
 * `text` (the contract of {@link getPinyin}).
 *
 * Longer context words win over shorter ones at the same position, so a more
 * specific match (目的地) is not clobbered by a shorter one (地上).
 */
export function applyPolyphonicOverrides(text: string, pinyinArray: string[]): string[] {
  const map = getLookup();
  if (map.size === 0) return pinyinArray;

  const cps = Array.from(text);
  // position-in-text → { reading, wordLen } of the winning (longest) match.
  let pending: Map<number, { reading: string; wordLen: number }> | null = null;

  for (let start = 0; start < cps.length; start++) {
    const maxLen = Math.min(maxWordCodePoints, cps.length - start);
    for (let len = 2; len <= maxLen; len++) {
      const word = cps.slice(start, start + len).join('');
      const overrides = map.get(word);
      if (!overrides) continue;
      for (const [offset, reading] of overrides) {
        const pos = start + offset;
        if (pos >= pinyinArray.length) continue;
        if (!pending) pending = new Map();
        const existing = pending.get(pos);
        if (!existing || len > existing.wordLen) {
          pending.set(pos, { reading, wordLen: len });
        }
      }
    }
  }

  if (!pending) return pinyinArray;
  const result = pinyinArray.slice();
  for (const [pos, { reading }] of pending) {
    if (result[pos]) result[pos] = reading;
  }
  return result;
}
