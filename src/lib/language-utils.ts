/**
 * Normalizes a language code to a standard ISO 639-1 (2-letter) code if possible.
 * Handles ISO 639-2 (3-letter) codes and locale tags (e.g., 'en-US' -> 'en').
 */
export function normalizeLanguageCode(lang: string | null | undefined): string {
    if (!lang) return 'en';
    
    // Trim, lowercase, and split by subtag delimiters
    const cleaned = lang.trim().toLowerCase().split(/[-_]/)[0];
    
    const langMap: Record<string, string> = {
        'eng': 'en',
        'zho': 'zh',
        'chi': 'zh',
        'fra': 'fr',
        'fre': 'fr',
        'spa': 'es',
        'ger': 'de',
        'deu': 'de',
        'jpn': 'ja',
        'kor': 'ko',
        'ita': 'it',
        'rus': 'ru',
        'por': 'pt',
        'nld': 'nl',
        'dut': 'nl',
        'swe': 'sv',
        'nor': 'no',
        'dan': 'da',
        'pol': 'pl',
        'tur': 'tr',
        'ara': 'ar',
        'hin': 'hi'
    };
    
    const result = langMap[cleaned] || cleaned;
    if (!/^[a-z]{2,3}$/.test(result)) {
        return 'en';
    }
    return result;
}
