/**
 * polyphonic — a curated contextual-reading override for Chinese 多音字
 * (polyphonic characters), layered on top of pinyin-pro's per-character
 * output in {@link getPinyin}.
 *
 * WHY THIS EXISTS
 * pinyin-pro segments a sentence and picks a reading per word, which already
 * resolves the COMMON polyphonic cases (银行→háng, 重生→chóng, 长久→cháng).
 * The data below corrects only the residue it gets wrong on the glyphs the
 * overlay annotates.
 *
 * SCOPE — DELIBERATELY TRIMMED TO THE SAFE SUBSET
 * The full rule set (ported from vrwarp/ruby-font-creator, which bakes the
 * same data into an OpenType `calt` GSUB table because a font cannot run a
 * segmenter at render time) was audited against pinyin-pro word by word. Two
 * findings shaped this trim:
 *
 *  1. pinyin-pro already reads the common Simplified polyphones correctly
 *     (地 0/28, 长 0/9, 倒 0/6, 兴 0/5, …). Overriding those is pure
 *     redundancy — it only adds collision risk — so they are DROPPED.
 *  2. Context-word matching mis-fires when a trigger is a substring of a
 *     different word: 和了→hú would fire on 温[和了], 好學→hào on 好[学校],
 *     调和→tiáo on 强[调和]谐, 教书→jiāo on 宗[教书]籍. The high-frequency,
 *     high-collision characters (得 着/著 地 长/長 还/還 好 为/為 和 差 教 …)
 *     are therefore DROPPED even where pinyin-pro errs, because a wrong
 *     override on running text is worse than a wrong reading on a rare word.
 *
 * What remains is the SAFE, HIGH-VALUE set: distinctive words pinyin-pro
 * genuinely mis-reads, where the trigger is not a plausible substring of a
 * common word. These cluster in two groups:
 *  - Traditional forms (樂, 傳, 難, 應, 創, 惡, 覺, 擔, 夾, 行, 重, 參/差 in
 *    參差) — pinyin-pro's phrase dictionary is Simplified-centric and misses
 *    these wholesale; and
 *  - a few rare/domain Simplified words it lacks (圣乐, 诗乐, 行传, 受难,
 *    圣都, 受创, 恶恶, 夹*).
 *
 * Each entry's `words` list is pruned to ONLY the triggers pinyin-pro
 * actually gets wrong, so nothing here is redundant. (A broader Traditional
 * weakness remains — pinyin-pro mis-reads non-polyphonic Traditional too;
 * fixing that wholesale would mean computing pinyin on the Simplified text,
 * which is out of scope for this override.)
 */

interface PolyphonicAlternate {
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
 * The trimmed, safe override set (see file header). Every `words` entry is a
 * trigger pinyin-pro reads wrong and that is distinctive enough not to be a
 * substring of a common word with a different reading.
 */
export const POLYPHONIC_ENTRIES: readonly PolyphonicEntry[] = [
  // --- Rare / domain Simplified words pinyin-pro's dictionary lacks ---
  { char: '乐', base: 'lè', alternates: [{ reading: 'yuè', words: ['圣乐', '诗乐'] }] },
  { char: '传', base: 'chuán', alternates: [{ reading: 'zhuàn', words: ['行传'] }] },
  { char: '难', base: 'nán', alternates: [{ reading: 'nàn', words: ['受难'] }] },
  { char: '都', base: 'dōu', alternates: [{ reading: 'dū', words: ['圣都'] }] },
  { char: '创', base: 'chuàng', alternates: [{ reading: 'chuāng', words: ['受创'] }] },
  { char: '恶', base: 'è', alternates: [{ reading: 'wù', words: ['恶恶'] }] },
  { char: '夹', base: 'jiā', alternates: [{ reading: 'jiá', words: ['夹杂', '夹克', '夹道', '夹攻'] }] },
  // 朝 is script-neutral; pinyin-pro mis-reads these literary words in both.
  { char: '朝', base: 'cháo', alternates: [{ reading: 'zhāo', words: ['朝露', '朝早'] }] },

  // --- Traditional forms (pinyin-pro's phrase dictionary is Simplified-centric) ---
  { char: '樂', base: 'lè', alternates: [{ reading: 'yuè', words: ['音樂', '聖樂', '樂器', '詩樂'] }] },
  { char: '傳', base: 'chuán', alternates: [{ reading: 'zhuàn', words: ['行傳'] }] },
  { char: '難', base: 'nán', alternates: [{ reading: 'nàn', words: ['患難', '苦難', '受難', '災難', '難民', '遇難'] }] },
  { char: '應', base: 'yīng', alternates: [{ reading: 'yìng', words: ['回應', '應驗', '響應', '感應'] }] },
  { char: '創', base: 'chuàng', alternates: [{ reading: 'chuāng', words: ['創傷', '受創'] }] },
  { char: '惡', base: 'è', alternates: [{ reading: 'wù', words: ['厭惡', '可惡', '惡惡'] }] },
  { char: '覺', base: 'jué', alternates: [{ reading: 'jiào', words: ['睡覺'] }] },
  { char: '擔', base: 'dān', alternates: [{ reading: 'dàn', words: ['重擔'] }] },
  { char: '夾', base: 'jiā', alternates: [{ reading: 'jiá', words: ['夾雜', '夾克', '夾衣', '夾道', '夾攻'] }] },
  { char: '行', base: 'xíng', alternates: [{ reading: 'háng', words: ['銀行', '行業', '內行'] }] },
  { char: '重', base: 'zhòng', alternates: [{ reading: 'chóng', words: ['重來', '重複', '重疊'] }] },
  // 參差 (cēncī): the Traditional pair pinyin-pro misses; Simplified 参差 it handles.
  { char: '參', base: 'shēn', alternates: [{ reading: 'cēn', words: ['參差'] }] },
  { char: '差', base: 'chà', alternates: [{ reading: 'cī', words: ['參差'] }] },
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
