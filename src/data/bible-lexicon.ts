import type { LexiconRule } from '../types/db';

export const BIBLE_ABBREVIATIONS = [
    "Gen.", "Ge.", "Gn.",
    "Ex.", "Exod.", "Exo.",
    "Lev.", "Le.", "Lv.",
    "Num.", "Nu.", "Nm.", "Nb.",
    "Deut.", "De.", "Dt.",
    "Josh.", "Jos.", "Jsh.",
    "Judg.", "Jdg.", "Jg.", "Jdgs.",
    "Ruth", "Rth.", "Ru.",
    "1 Sam.", "1 Sa.", "1S.", "I Sa.", "1 Sm.", "1Sa.", "I Sam.", "1Sam.", "I Samuel", "1st Samuel", "First Samuel",
    "2 Sam.", "2 Sa.", "2S.", "II Sa.", "2 Sm.", "2Sa.", "II Sam.", "2Sam.", "II Samuel", "2nd Samuel", "Second Samuel",
    "1 Kings", "1 Kgs.", "1 Ki.", "1K.", "I Kgs.", "1Kgs.", "I Ki.", "1Ki.", "I Kings", "1st Kings", "First Kings",
    "2 Kings", "2 Kgs.", "2 Ki.", "2K.", "II Kgs.", "2Kgs.", "II Ki.", "2Ki.", "II Kings", "2nd Kings", "Second Kings",
    "1 Chron.", "1 Chr.", "1 Ch.", "1Ch.", "I Chr.", "1Chr.", "I Ch.", "1Ch.", "I Chron.", "1Chron.", "I Chronicles", "1st Chronicles", "First Chronicles",
    "2 Chron.", "2 Chr.", "2 Ch.", "2Ch.", "II Chr.", "2Chr.", "II Ch.", "2Ch.", "II Chron.", "2Chron.", "II Chronicles", "2nd Chronicles", "Second Chronicles",
    "Ezra", "Ezr.",
    "Neh.", "Ne.",
    "Esth.", "Es.",
    "Job", "Jb.",
    "Ps.", "Pss.", "Psa.", "Psm.",
    "Prov.", "Pro.", "Pr.", "Prv.",
    "Eccles.", "Eccl.", "Ecc.", "Ec.",
    "Song", "Song of Sol.", "So.", "Cant.",
    "Isa.", "Is.",
    "Jer.", "Je.", "Jr.",
    "Lam.", "La.", "Lm.",
    "Ezek.", "Eze.", "Ezk.",
    "Dan.", "Da.", "Dn.",
    "Hos.", "Ho.",
    "Joel", "Jl.",
    "Amos", "Am.",
    "Obad.", "Ob.",
    "Jonah", "Jnh.", "Jon.",
    "Mic.", "Mi.",
    "Nah.", "Na.",
    "Hab.", "Hb.",
    "Zeph.", "Zep.", "Zp.",
    "Hag.", "Hg.",
    "Zech.", "Zec.", "Zc.",
    "Mal.", "Ma.", "Ml.",
    "Matt.", "Mt.",
    "Mark", "Mk.", "Mrk.",
    "Luke", "Lk.", "Lu.",
    "John", "Jn.", "Jhn.",
    "Acts", "Ac.",
    "Rom.", "Ro.", "Rm.",
    "1 Cor.", "1 Co.", "I Cor.", "1Cor.", "I Co.", "1Co.", "I Corinthians", "1st Corinthians", "First Corinthians",
    "2 Cor.", "2 Co.", "II Cor.", "2Cor.", "II Co.", "2Co.", "II Corinthians", "2nd Corinthians", "Second Corinthians",
    "Gal.", "Ga.",
    "Eph.", "Ep.",
    "Phil.", "Php.", "Pp.",
    "Col.", "Co.",
    "1 Thess.", "1 Th.", "I Thess.", "1Thess.", "I Th.", "1Th.", "I Thessalonians", "1st Thessalonians", "First Thessalonians",
    "2 Thess.", "2 Th.", "II Thess.", "2Thess.", "II Th.", "2Th.", "II Thessalonians", "2nd Thessalonians", "Second Thessalonians",
    "1 Tim.", "1 Ti.", "I Tim.", "1Tim.", "I Ti.", "1Ti.", "I Timothy", "1st Timothy", "First Timothy",
    "2 Tim.", "2 Ti.", "II Tim.", "2Tim.", "II Ti.", "2Ti.", "II Timothy", "2nd Timothy", "Second Timothy",
    "Titus", "Tit.", "Ti.",
    "Philem.", "Phm.",
    "Heb.", "He.",
    "James", "Jas.", "Jm.",
    "1 Pet.", "1 Pe.", "1 Pt.", "I Pet.", "1Pet.", "I Pe.", "1Pe.", "I Pt.", "1Pt.", "I Peter", "1st Peter", "First Peter",
    "2 Pet.", "2 Pe.", "2 Pt.", "II Pet.", "2Pet.", "II Pe.", "2Pe.", "II Pt.", "2Pt.", "II Peter", "2nd Peter", "Second Peter",
    "1 John", "1 Jn.", "1 Jhn.", "1 Jo.", "I John", "1John", "I Jn.", "1Jn.", "I Jo.", "1Jo.", "I John", "1st John", "First John",
    "2 John", "2 Jn.", "2 Jhn.", "2 Jo.", "II John", "2John", "II Jn.", "2Jn.", "II Jo.", "2Jo.", "II John", "2nd John", "Second John",
    "3 John", "3 Jn.", "3 Jhn.", "3 Jo.", "III John", "3John", "III Jn.", "3Jn.", "III Jo.", "3Jo.", "III John", "3rd John", "Third John",
    "Jude", "Jd.",
    "Rev.", "Rv.", "Revelation",
    "v.", "vs.", "vv.", "ch.", "chap."
];

// Based on lexicon-bible.csv
export const BIBLE_LEXICON_RULES: Omit<LexiconRule, 'id' | 'created'>[] = [
    {
        original: "\\b(Gen|Ge|Gn)\\.?(?=\\s?\\d+)",
        replacement: "Genesis",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Ex|Exod|Exo)\\.?(?=\\s?\\d+)",
        replacement: "Exodus",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Lev|Le|Lv)\\.?(?=\\s?\\d+)",
        replacement: "Leviticus",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Num|Nu|Nm|Nb)\\.?(?=\\s?\\d+)",
        replacement: "Numbers",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Deut|De|Dt)\\.?(?=\\s?\\d+)",
        replacement: "Deuteronomy",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Josh|Jos|Jsh)\\.?(?=\\s?\\d+)",
        replacement: "Joshua",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Judg|Jdg|Jg|Jdgs)\\.?(?=\\s?\\d+)",
        replacement: "Judges",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Ruth|Rth|Ru)\\.?(?=\\s?\\d+)",
        replacement: "Ruth",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(1\\s?Sam|1\\s?Sa|1S|I\\s?Sa|1\\s?Sm|1Sa|I\\s?Sam|1Sam|I\\s?Samuel|1st\\s?Samuel|First\\s?Samuel|1\\s?Samuel)\\.?(?=\\s?\\d+)",
        replacement: "First Samuel",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(2\\s?Sam|2\\s?Sa|2S|II\\s?Sa|2\\s?Sm|2Sa|II\\s?Sam|2Sam|II\\s?Samuel|2nd\\s?Samuel|Second\\s?Samuel|2\\s?Samuel)\\.?(?=\\s?\\d+)",
        replacement: "Second Samuel",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(1\\s?Kings|1\\s?Kgs|1\\s?Ki|1K|I\\s?Kgs|1Kgs|I\\s?Ki|1Ki|I\\s?Kings|1st\\s?Kings|First\\s?Kings|1\\s?King)\\.?(?=\\s?\\d+)",
        replacement: "First Kings",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(2\\s?Kings|2\\s?Kgs|2\\s?Ki|2K|II\\s?Kgs|2Kgs|II\\s?Ki|2Ki|II\\s?Kings|2nd\\s?Kings|Second\\s?Kings|2\\s?King)\\.?(?=\\s?\\d+)",
        replacement: "Second Kings",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(1\\s?Chron|1\\s?Chr|1\\s?Ch|1Ch|I\\s?Chr|1Chr|I\\s?Ch|1Ch|I\\s?Chron|1Chron|I\\s?Chronicles|1st\\s?Chronicles|First\\s?Chronicles|1\\s?Chronicles)\\.?(?=\\s?\\d+)",
        replacement: "First Chronicles",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(2\\s?Chron|2\\s?Chr|2\\s?Ch|2Ch|II\\s?Chr|2Chr|II\\s?Ch|2Ch|II\\s?Chron|2Chron|II\\s?Chronicles|2nd\\s?Chronicles|Second\\s?Chronicles|2\\s?Chronicles)\\.?(?=\\s?\\d+)",
        replacement: "Second Chronicles",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Ezra|Ezr)\\.?(?=\\s?\\d+)",
        replacement: "Ezra",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Neh|Ne)\\.?(?=\\s?\\d+)",
        replacement: "Nehemiah",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Esth|Es)\\.?(?=\\s?\\d+)",
        replacement: "Esther",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Job|Jb)\\.?(?=\\s?\\d+)",
        replacement: "Jobe",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Ps|Pss|Psa|Psm)\\.?(?=\\s?\\d+)",
        replacement: "Psalms",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Prov|Pro|Pr|Prv)\\.?(?=\\s?\\d+)",
        replacement: "Proverbs",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Eccles|Eccl|Ecc|Ec)\\.?(?=\\s?\\d+)",
        replacement: "Ecclesiastes",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Song|Song\\s?of\\s?Sol|So|Cant)\\.?(?=\\s?\\d+)",
        replacement: "Song of Solomon",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Isa|Is)\\.?(?=\\s?\\d+)",
        replacement: "Isaiah",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Jer|Je|Jr)\\.?(?=\\s?\\d+)",
        replacement: "Jeremiah",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Lam|La|Lm)\\.?(?=\\s?\\d+)",
        replacement: "Lamentations",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Ezek|Eze|Ezk)\\.?(?=\\s?\\d+)",
        replacement: "Ezekiel",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Dan|Da|Dn)\\.?(?=\\s?\\d+)",
        replacement: "Daniel",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Hos|Ho)\\.?(?=\\s?\\d+)",
        replacement: "Hosea",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Joel|Jl)\\.?(?=\\s?\\d+)",
        replacement: "Joel",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Amos|Am)\\.?(?=\\s?\\d+)",
        replacement: "Amos",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Obad|Ob)\\.?(?=\\s?\\d+)",
        replacement: "Obadiah",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Jonah|Jnh|Jon)\\.?(?=\\s?\\d+)",
        replacement: "Jonah",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Mic|Mi)\\.?(?=\\s?\\d+)",
        replacement: "Micah",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Nah|Na)\\.?(?=\\s?\\d+)",
        replacement: "Nahum",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Hab|Hb)\\.?(?=\\s?\\d+)",
        replacement: "Habakkuk",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Zeph|Zep|Zp)\\.?(?=\\s?\\d+)",
        replacement: "Zephaniah",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Hag|Hg)\\.?(?=\\s?\\d+)",
        replacement: "Haggai",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Zech|Zec|Zc)\\.?(?=\\s?\\d+)",
        replacement: "Zechariah",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Mal|Ma|Ml)\\.?(?=\\s?\\d+)",
        replacement: "Malachi",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Matt|Mt)\\.?(?=\\s?\\d+)",
        replacement: "Matthew",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Mark|Mk|Mrk)\\.?(?=\\s?\\d+)",
        replacement: "Mark",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Luke|Lk|Lu)\\.?(?=\\s?\\d+)",
        replacement: "Luke",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(John|Jn|Jhn)\\.?(?=\\s?\\d+)",
        replacement: "John",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Acts|Ac)\\.?(?=\\s?\\d+)",
        replacement: "Acts",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Rom|Ro|Rm)\\.?(?=\\s?\\d+)",
        replacement: "Romans",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(1\\s?Cor|1\\s?Co|I\\s?Cor|1Cor|I\\s?Co|1Co|I\\s?Corinthians|1st\\s?Corinthians|First\\s?Corinthians|1\\s?Corinthians)\\.?(?=\\s?\\d+)",
        replacement: "First Corinthians",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(2\\s?Cor|2\\s?Co|II\\s?Cor|2Cor|II\\s?Co|2Co|II\\s?Corinthians|2nd\\s?Corinthians|Second\\s?Corinthians|2\\s?Corinthians)\\.?(?=\\s?\\d+)",
        replacement: "Second Corinthians",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Gal|Ga)\\.?(?=\\s?\\d+)",
        replacement: "Galatians",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Eph|Ep)\\.?(?=\\s?\\d+)",
        replacement: "Ephesians",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Phil|Php|Pp)\\.?(?=\\s?\\d+)",
        replacement: "Philippians",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Col|Co)\\.?(?=\\s?\\d+)",
        replacement: "Colossians",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(1\\s?Thess|1\\s?Th|I\\s?Thess|1Thess|I\\s?Th|1Th|I\\s?Thessalonians|1st\\s?Thessalonians|First\\s?Thessalonians|1\\s?Thessalonians)\\.?(?=\\s?\\d+)",
        replacement: "First Thessalonians",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(2\\s?Thess|2\\s?Th|II\\s?Thess|2Thess|II\\s?Th|2Th|II\\s?Thessalonians|2nd\\s?Thessalonians|Second\\s?Thessalonians|2\\s?Thessalonians)\\.?(?=\\s?\\d+)",
        replacement: "Second Thessalonians",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(1\\s?Tim|1\\s?Ti|I\\s?Tim|1Tim|I\\s?Ti|1Ti|I\\s?Timothy|1st\\s?Timothy|First\\s?Timothy|1\\s?Timothy)\\.?(?=\\s?\\d+)",
        replacement: "First Timothy",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(2\\s?Tim|2\\s?Ti|II\\s?Tim|2Tim|II\\s?Ti|2Ti|II\\s?Timothy|2nd\\s?Timothy|Second\\s?Timothy|2\\s?Timothy)\\.?(?=\\s?\\d+)",
        replacement: "Second Timothy",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Titus|Tit|Ti)\\.?(?=\\s?\\d+)",
        replacement: "Titus",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Philem|Phm)\\.?(?=\\s?\\d+)",
        replacement: "Philemon",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Heb|He)\\.?(?=\\s?\\d+)",
        replacement: "Hebrews",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(James|Jas|Jm)\\.?(?=\\s?\\d+)",
        replacement: "James",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(1\\s?Pet|1\\s?Pe|1\\s?Pt|I\\s?Pet|1Pet|I\\s?Pe|1Pe|I\\s?Pt|1Pt|I\\s?Peter|1st\\s?Peter|First\\s?Peter|1\\s?Peter)\\.?(?=\\s?\\d+)",
        replacement: "First Peter",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(2\\s?Pet|2\\s?Pe|2\\s?Pt|II\\s?Pet|2Pet|II\\s?Pe|2Pe|II\\s?Pt|2Pt|II\\s?Peter|2nd\\s?Peter|Second\\s?Peter|2\\s?Peter)\\.?(?=\\s?\\d+)",
        replacement: "Second Peter",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(1\\s?John|1\\s?Jn|1\\s?Jhn|1\\s?Jo|I\\s?John|1John|I\\s?Jn|1Jn|I\\s?Jo|1Jo|I\\s?John|1st\\s?John|First\\s?John)\\.?(?=\\s?\\d+)",
        replacement: "First John",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(2\\s?John|2\\s?Jn|2\\s?Jhn|2\\s?Jo|II\\s?John|2John|II\\s?Jn|2Jn|II\\s?Jo|2Jo|II\\s?John|2nd\\s?John|Second\\s?John)\\.?(?=\\s?\\d+)",
        replacement: "Second John",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(3\\s?John|3\\s?Jn|3\\s?Jhn|3\\s?Jo|III\\s?John|3John|III\\s?Jn|3Jn|III\\s?Jo|3Jo|III\\s?John|3rd\\s?John|Third\\s?John)\\.?(?=\\s?\\d+)",
        replacement: "Third John",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Jude|Jd)\\.?(?=\\s?\\d+)",
        replacement: "Jude",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(Rev|Rv|Revelation)\\.?(?=\\s?\\d+)",
        replacement: "Revelation",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "(?<=\\d:\\d{1,3})(–|-)(?=\\d{1,3})",
        replacement: " to ",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(v|vs|vv)\\.?\\s?(?=\\d+)",
        replacement: "verse ",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "\\b(ch|chap)\\.?(?=\\s?\\d+)",
        replacement: "chapter",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "(\\d)a\\b",
        replacement: "$1 ae",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'en'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(创|創)(?=\\s?\\d+)",
        replacement: "創世記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(出)(?=\\s?\\d+)",
        replacement: "出埃及記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(利)(?=\\s?\\d+)",
        replacement: "利未記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(民)(?=\\s?\\d+)",
        replacement: "民數記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(申)(?=\\s?\\d+)",
        replacement: "申命記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(书|書)(?=\\s?\\d+)",
        replacement: "約書亞記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(士)(?=\\s?\\d+)",
        replacement: "士師記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(得)(?=\\s?\\d+)",
        replacement: "路得記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(撒上)(?=\\s?\\d+)",
        replacement: "撒母耳記上",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(撒下)(?=\\s?\\d+)",
        replacement: "撒母耳記下",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(王上)(?=\\s?\\d+)",
        replacement: "列王紀上",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(王下)(?=\\s?\\d+)",
        replacement: "列王紀下",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(代上)(?=\\s?\\d+)",
        replacement: "歷代志上",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(代下)(?=\\s?\\d+)",
        replacement: "歷代志下",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(拉)(?=\\s?\\d+)",
        replacement: "以斯拉記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(尼)(?=\\s?\\d+)",
        replacement: "尼希米記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(斯)(?=\\s?\\d+)",
        replacement: "以斯帖記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(伯)(?=\\s?\\d+)",
        replacement: "約伯記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(诗|詩)(?=\\s?\\d+)",
        replacement: "詩篇",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(箴)(?=\\s?\\d+)",
        replacement: "箴言",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(传|傳)(?=\\s?\\d+)",
        replacement: "傳道書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(歌)(?=\\s?\\d+)",
        replacement: "雅歌",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(赛|賽)(?=\\s?\\d+)",
        replacement: "以賽亞書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(耶)(?=\\s?\\d+)",
        replacement: "耶利米書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(哀)(?=\\s?\\d+)",
        replacement: "耶利米哀歌",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(结|結)(?=\\s?\\d+)",
        replacement: "以西結書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(但)(?=\\s?\\d+)",
        replacement: "但以理書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(何)(?=\\s?\\d+)",
        replacement: "何西阿書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(珥)(?=\\s?\\d+)",
        replacement: "約珥書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(摩)(?=\\s?\\d+)",
        replacement: "阿摩司書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(俄)(?=\\s?\\d+)",
        replacement: "俄巴底亞書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(拿)(?=\\s?\\d+)",
        replacement: "約拿書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(弥|彌)(?=\\s?\\d+)",
        replacement: "彌迦書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(鸿|鴻)(?=\\s?\\d+)",
        replacement: "那鴻書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(哈)(?=\\s?\\d+)",
        replacement: "哈巴谷書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(番)(?=\\s?\\d+)",
        replacement: "西番雅書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(该|該)(?=\\s?\\d+)",
        replacement: "哈該書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(亚|亞)(?=\\s?\\d+)",
        replacement: "撒迦利亞書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(玛|瑪)(?=\\s?\\d+)",
        replacement: "瑪拉基書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(太)(?=\\s?\\d+)",
        replacement: "馬太福音",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(可)(?=\\s?\\d+)",
        replacement: "馬可福音",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(路)(?=\\s?\\d+)",
        replacement: "路加福音",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(约|約)(?=\\s?\\d+)",
        replacement: "約翰福音",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(徒)(?=\\s?\\d+)",
        replacement: "使徒行傳",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(罗|羅)(?=\\s?\\d+)",
        replacement: "羅馬書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(林前)(?=\\s?\\d+)",
        replacement: "哥林多前書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(林后|林後)(?=\\s?\\d+)",
        replacement: "哥林多後書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(加)(?=\\s?\\d+)",
        replacement: "加拉太書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(弗)(?=\\s?\\d+)",
        replacement: "以弗所書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(腓)(?=\\s?\\d+)",
        replacement: "腓立比書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(西)(?=\\s?\\d+)",
        replacement: "歌羅西書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(帖前)(?=\\s?\\d+)",
        replacement: "帖撒羅尼迦前書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(帖后|帖後)(?=\\s?\\d+)",
        replacement: "帖撒羅尼迦後書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(提前)(?=\\s?\\d+)",
        replacement: "提摩太前書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(提后|提後)(?=\\s?\\d+)",
        replacement: "提摩太後書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(多)(?=\\s?\\d+)",
        replacement: "提多書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(门|門)(?=\\s?\\d+)",
        replacement: "腓利門書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(来|來)(?=\\s?\\d+)",
        replacement: "希伯來書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(雅)(?=\\s?\\d+)",
        replacement: "雅各書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(彼前)(?=\\s?\\d+)",
        replacement: "彼得前書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(彼后|彼後)(?=\\s?\\d+)",
        replacement: "彼得後書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(约一|約一)(?=\\s?\\d+)",
        replacement: "約翰一書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(约二|約二)(?=\\s?\\d+)",
        replacement: "約翰二書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(约三|約三)(?=\\s?\\d+)",
        replacement: "約翰三書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(犹|猶)(?=\\s?\\d+)",
        replacement: "猶大書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(启|啟)(?=\\s?\\d+)",
        replacement: "啟示錄",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    // ZH utility rules (traditional)
    {
        original: "(?<=\\d:\\d{1,3})(–|-)(?=\\d{1,3})",
        replacement: "至",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "\\b(v|vs|vv)\\.?\\s?(?=\\d+)",
        replacement: "節",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "\\b(ch|chap)\\.?(?=\\s?\\d+)",
        replacement: "章",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    }
,
    {
        original: "(?<![\\u4e00-\\u9fa5])(创)(?=\\s?\\d+)",
        replacement: "创世记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(出)(?=\\s?\\d+)",
        replacement: "出埃及记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(利)(?=\\s?\\d+)",
        replacement: "利未记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(民)(?=\\s?\\d+)",
        replacement: "民数记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(申)(?=\\s?\\d+)",
        replacement: "申命记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(书)(?=\\s?\\d+)",
        replacement: "约书亚记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(士)(?=\\s?\\d+)",
        replacement: "士师记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(得)(?=\\s?\\d+)",
        replacement: "路得记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(撒上)(?=\\s?\\d+)",
        replacement: "撒母耳记上",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(撒下)(?=\\s?\\d+)",
        replacement: "撒母耳记下",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(王上)(?=\\s?\\d+)",
        replacement: "列王纪上",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(王下)(?=\\s?\\d+)",
        replacement: "列王纪下",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(代上)(?=\\s?\\d+)",
        replacement: "历代志上",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(代下)(?=\\s?\\d+)",
        replacement: "历代志下",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(拉)(?=\\s?\\d+)",
        replacement: "以斯拉记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(尼)(?=\\s?\\d+)",
        replacement: "尼希米记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(斯)(?=\\s?\\d+)",
        replacement: "以斯帖记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(伯)(?=\\s?\\d+)",
        replacement: "约伯记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(诗)(?=\\s?\\d+)",
        replacement: "诗篇",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(箴)(?=\\s?\\d+)",
        replacement: "箴言",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(传)(?=\\s?\\d+)",
        replacement: "传道书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(歌)(?=\\s?\\d+)",
        replacement: "雅歌",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(赛)(?=\\s?\\d+)",
        replacement: "以赛亚书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(耶)(?=\\s?\\d+)",
        replacement: "耶利米书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(哀)(?=\\s?\\d+)",
        replacement: "耶利米哀歌",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(结)(?=\\s?\\d+)",
        replacement: "以西结书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(但)(?=\\s?\\d+)",
        replacement: "但以理书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(何)(?=\\s?\\d+)",
        replacement: "何西阿书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(珥)(?=\\s?\\d+)",
        replacement: "约珥书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(摩)(?=\\s?\\d+)",
        replacement: "阿摩司书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(俄)(?=\\s?\\d+)",
        replacement: "俄巴底亚书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(拿)(?=\\s?\\d+)",
        replacement: "约拿书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(弥)(?=\\s?\\d+)",
        replacement: "弥迦书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(鸿)(?=\\s?\\d+)",
        replacement: "那鸿书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(哈)(?=\\s?\\d+)",
        replacement: "哈巴谷书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(番)(?=\\s?\\d+)",
        replacement: "西番雅书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(该)(?=\\s?\\d+)",
        replacement: "哈该书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(亚)(?=\\s?\\d+)",
        replacement: "撒迦利亚书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(玛)(?=\\s?\\d+)",
        replacement: "玛拉基书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(太)(?=\\s?\\d+)",
        replacement: "马太福音",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(可)(?=\\s?\\d+)",
        replacement: "马可福音",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(路)(?=\\s?\\d+)",
        replacement: "路加福音",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(约)(?=\\s?\\d+)",
        replacement: "约翰福音",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(徒)(?=\\s?\\d+)",
        replacement: "使徒行传",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(罗)(?=\\s?\\d+)",
        replacement: "罗马书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(林前)(?=\\s?\\d+)",
        replacement: "哥林多前书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(林后)(?=\\s?\\d+)",
        replacement: "哥林多后书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(加)(?=\\s?\\d+)",
        replacement: "加拉太书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(弗)(?=\\s?\\d+)",
        replacement: "以弗所书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(腓)(?=\\s?\\d+)",
        replacement: "腓立比书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(西)(?=\\s?\\d+)",
        replacement: "歌罗西书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(帖前)(?=\\s?\\d+)",
        replacement: "帖撒罗尼迦前书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(帖后)(?=\\s?\\d+)",
        replacement: "帖撒罗尼迦后书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(提前)(?=\\s?\\d+)",
        replacement: "提摩太前书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(提后)(?=\\s?\\d+)",
        replacement: "提摩太后书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(多)(?=\\s?\\d+)",
        replacement: "提多书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(门)(?=\\s?\\d+)",
        replacement: "腓利门书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(来)(?=\\s?\\d+)",
        replacement: "希伯来书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(雅)(?=\\s?\\d+)",
        replacement: "雅各书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(彼前)(?=\\s?\\d+)",
        replacement: "彼得前书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(彼后)(?=\\s?\\d+)",
        replacement: "彼得后书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(约一)(?=\\s?\\d+)",
        replacement: "约翰一书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(约二)(?=\\s?\\d+)",
        replacement: "约翰二书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(约三)(?=\\s?\\d+)",
        replacement: "约翰三书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(犹)(?=\\s?\\d+)",
        replacement: "犹大书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(启)(?=\\s?\\d+)",
        replacement: "启示录",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(創)(?=\\s?\\d+)",
        replacement: "創世記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(出)(?=\\s?\\d+)",
        replacement: "出埃及記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(利)(?=\\s?\\d+)",
        replacement: "利未記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(民)(?=\\s?\\d+)",
        replacement: "民數記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(申)(?=\\s?\\d+)",
        replacement: "申命記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(書)(?=\\s?\\d+)",
        replacement: "約書亞記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(士)(?=\\s?\\d+)",
        replacement: "士師記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(得)(?=\\s?\\d+)",
        replacement: "路得記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(撒上)(?=\\s?\\d+)",
        replacement: "撒母耳記上",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(撒下)(?=\\s?\\d+)",
        replacement: "撒母耳記下",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(王上)(?=\\s?\\d+)",
        replacement: "列王紀上",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(王下)(?=\\s?\\d+)",
        replacement: "列王紀下",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(代上)(?=\\s?\\d+)",
        replacement: "歷代志上",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(代下)(?=\\s?\\d+)",
        replacement: "歷代志下",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(拉)(?=\\s?\\d+)",
        replacement: "以斯拉記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(尼)(?=\\s?\\d+)",
        replacement: "尼希米記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(斯)(?=\\s?\\d+)",
        replacement: "以斯帖記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(伯)(?=\\s?\\d+)",
        replacement: "約伯記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(詩)(?=\\s?\\d+)",
        replacement: "詩篇",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(箴)(?=\\s?\\d+)",
        replacement: "箴言",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(傳)(?=\\s?\\d+)",
        replacement: "傳道書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(歌)(?=\\s?\\d+)",
        replacement: "雅歌",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(賽)(?=\\s?\\d+)",
        replacement: "以賽亞書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(耶)(?=\\s?\\d+)",
        replacement: "耶利米書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(哀)(?=\\s?\\d+)",
        replacement: "耶利米哀歌",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(結)(?=\\s?\\d+)",
        replacement: "以西結書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(但)(?=\\s?\\d+)",
        replacement: "但以理書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(何)(?=\\s?\\d+)",
        replacement: "何西阿書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(珥)(?=\\s?\\d+)",
        replacement: "約珥書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(摩)(?=\\s?\\d+)",
        replacement: "阿摩司書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(俄)(?=\\s?\\d+)",
        replacement: "俄巴底亞書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(拿)(?=\\s?\\d+)",
        replacement: "約拿書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(彌)(?=\\s?\\d+)",
        replacement: "彌迦書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(鴻)(?=\\s?\\d+)",
        replacement: "那鴻書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(哈)(?=\\s?\\d+)",
        replacement: "哈巴谷書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(番)(?=\\s?\\d+)",
        replacement: "西番雅書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(該)(?=\\s?\\d+)",
        replacement: "哈該書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(亞)(?=\\s?\\d+)",
        replacement: "撒迦利亞書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(瑪)(?=\\s?\\d+)",
        replacement: "瑪拉基書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(太)(?=\\s?\\d+)",
        replacement: "馬太福音",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(可)(?=\\s?\\d+)",
        replacement: "馬可福音",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(路)(?=\\s?\\d+)",
        replacement: "路加福音",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(約)(?=\\s?\\d+)",
        replacement: "約翰福音",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(徒)(?=\\s?\\d+)",
        replacement: "使徒行傳",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(羅)(?=\\s?\\d+)",
        replacement: "羅馬書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(林前)(?=\\s?\\d+)",
        replacement: "哥林多前書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(林後)(?=\\s?\\d+)",
        replacement: "哥林多後書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(加)(?=\\s?\\d+)",
        replacement: "加拉太書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(弗)(?=\\s?\\d+)",
        replacement: "以弗所書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(腓)(?=\\s?\\d+)",
        replacement: "腓立比書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(西)(?=\\s?\\d+)",
        replacement: "歌羅西書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(帖前)(?=\\s?\\d+)",
        replacement: "帖撒羅尼迦前書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(帖後)(?=\\s?\\d+)",
        replacement: "帖撒羅尼迦後書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(提前)(?=\\s?\\d+)",
        replacement: "提摩太前書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(提後)(?=\\s?\\d+)",
        replacement: "提摩太後書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(多)(?=\\s?\\d+)",
        replacement: "提多書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(門)(?=\\s?\\d+)",
        replacement: "腓利門書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(來)(?=\\s?\\d+)",
        replacement: "希伯來書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(雅)(?=\\s?\\d+)",
        replacement: "雅各書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(彼前)(?=\\s?\\d+)",
        replacement: "彼得前書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(彼後)(?=\\s?\\d+)",
        replacement: "彼得後書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(約一)(?=\\s?\\d+)",
        replacement: "約翰一書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(約二)(?=\\s?\\d+)",
        replacement: "約翰二書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(約三)(?=\\s?\\d+)",
        replacement: "約翰三書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(猶)(?=\\s?\\d+)",
        replacement: "猶大書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(啟)(?=\\s?\\d+)",
        replacement: "啟示錄",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    }
,
    {
        original: "(?<![\\u4e00-\\u9fa5])(创)(?=\\s?\\d+)",
        replacement: "创世记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(出)(?=\\s?\\d+)",
        replacement: "出埃及记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(利)(?=\\s?\\d+)",
        replacement: "利未记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(民)(?=\\s?\\d+)",
        replacement: "民数记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(申)(?=\\s?\\d+)",
        replacement: "申命记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(书)(?=\\s?\\d+)",
        replacement: "约书亚记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(士)(?=\\s?\\d+)",
        replacement: "士师记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(得)(?=\\s?\\d+)",
        replacement: "路得记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(撒上)(?=\\s?\\d+)",
        replacement: "撒母耳记上",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(撒下)(?=\\s?\\d+)",
        replacement: "撒母耳记下",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(王上)(?=\\s?\\d+)",
        replacement: "列王纪上",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(王下)(?=\\s?\\d+)",
        replacement: "列王纪下",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(代上)(?=\\s?\\d+)",
        replacement: "历代志上",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(代下)(?=\\s?\\d+)",
        replacement: "历代志下",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(拉)(?=\\s?\\d+)",
        replacement: "以斯拉记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(尼)(?=\\s?\\d+)",
        replacement: "尼希米记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(斯)(?=\\s?\\d+)",
        replacement: "以斯帖记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(伯)(?=\\s?\\d+)",
        replacement: "约伯记",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(诗)(?=\\s?\\d+)",
        replacement: "诗篇",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(箴)(?=\\s?\\d+)",
        replacement: "箴言",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(传)(?=\\s?\\d+)",
        replacement: "传道书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(歌)(?=\\s?\\d+)",
        replacement: "雅歌",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(赛)(?=\\s?\\d+)",
        replacement: "以赛亚书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(耶)(?=\\s?\\d+)",
        replacement: "耶利米书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(哀)(?=\\s?\\d+)",
        replacement: "耶利米哀歌",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(结)(?=\\s?\\d+)",
        replacement: "以西结书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(但)(?=\\s?\\d+)",
        replacement: "但以理书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(何)(?=\\s?\\d+)",
        replacement: "何西阿书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(珥)(?=\\s?\\d+)",
        replacement: "约珥书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(摩)(?=\\s?\\d+)",
        replacement: "阿摩司书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(俄)(?=\\s?\\d+)",
        replacement: "俄巴底亚书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(拿)(?=\\s?\\d+)",
        replacement: "约拿书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(弥)(?=\\s?\\d+)",
        replacement: "弥迦书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(鸿)(?=\\s?\\d+)",
        replacement: "那鸿书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(哈)(?=\\s?\\d+)",
        replacement: "哈巴谷书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(番)(?=\\s?\\d+)",
        replacement: "西番雅书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(该)(?=\\s?\\d+)",
        replacement: "哈该书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(亚)(?=\\s?\\d+)",
        replacement: "撒迦利亚书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(玛)(?=\\s?\\d+)",
        replacement: "玛拉基书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(太)(?=\\s?\\d+)",
        replacement: "马太福音",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(可)(?=\\s?\\d+)",
        replacement: "马可福音",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(路)(?=\\s?\\d+)",
        replacement: "路加福音",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(约)(?=\\s?\\d+)",
        replacement: "约翰福音",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(徒)(?=\\s?\\d+)",
        replacement: "使徒行传",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(罗)(?=\\s?\\d+)",
        replacement: "罗马书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(林前)(?=\\s?\\d+)",
        replacement: "哥林多前书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(林后)(?=\\s?\\d+)",
        replacement: "哥林多后书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(加)(?=\\s?\\d+)",
        replacement: "加拉太书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(弗)(?=\\s?\\d+)",
        replacement: "以弗所书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(腓)(?=\\s?\\d+)",
        replacement: "腓立比书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(西)(?=\\s?\\d+)",
        replacement: "歌罗西书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(帖前)(?=\\s?\\d+)",
        replacement: "帖撒罗尼迦前书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(帖后)(?=\\s?\\d+)",
        replacement: "帖撒罗尼迦后书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(提前)(?=\\s?\\d+)",
        replacement: "提摩太前书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(提后)(?=\\s?\\d+)",
        replacement: "提摩太后书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(多)(?=\\s?\\d+)",
        replacement: "提多书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(门)(?=\\s?\\d+)",
        replacement: "腓利门书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(来)(?=\\s?\\d+)",
        replacement: "希伯来书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(雅)(?=\\s?\\d+)",
        replacement: "雅各书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(彼前)(?=\\s?\\d+)",
        replacement: "彼得前书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(彼后)(?=\\s?\\d+)",
        replacement: "彼得后书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(约一)(?=\\s?\\d+)",
        replacement: "约翰一书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(约二)(?=\\s?\\d+)",
        replacement: "约翰二书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(约三)(?=\\s?\\d+)",
        replacement: "约翰三书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(犹)(?=\\s?\\d+)",
        replacement: "犹大书",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(启)(?=\\s?\\d+)",
        replacement: "启示录",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(創)(?=\\s?\\d+)",
        replacement: "創世記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(出)(?=\\s?\\d+)",
        replacement: "出埃及記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(利)(?=\\s?\\d+)",
        replacement: "利未記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(民)(?=\\s?\\d+)",
        replacement: "民數記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(申)(?=\\s?\\d+)",
        replacement: "申命記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(書)(?=\\s?\\d+)",
        replacement: "約書亞記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(士)(?=\\s?\\d+)",
        replacement: "士師記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(得)(?=\\s?\\d+)",
        replacement: "路得記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(撒上)(?=\\s?\\d+)",
        replacement: "撒母耳記上",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(撒下)(?=\\s?\\d+)",
        replacement: "撒母耳記下",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(王上)(?=\\s?\\d+)",
        replacement: "列王紀上",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(王下)(?=\\s?\\d+)",
        replacement: "列王紀下",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(代上)(?=\\s?\\d+)",
        replacement: "歷代志上",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(代下)(?=\\s?\\d+)",
        replacement: "歷代志下",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(拉)(?=\\s?\\d+)",
        replacement: "以斯拉記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(尼)(?=\\s?\\d+)",
        replacement: "尼希米記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(斯)(?=\\s?\\d+)",
        replacement: "以斯帖記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(伯)(?=\\s?\\d+)",
        replacement: "約伯記",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(詩)(?=\\s?\\d+)",
        replacement: "詩篇",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(箴)(?=\\s?\\d+)",
        replacement: "箴言",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(傳)(?=\\s?\\d+)",
        replacement: "傳道書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(歌)(?=\\s?\\d+)",
        replacement: "雅歌",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(賽)(?=\\s?\\d+)",
        replacement: "以賽亞書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(耶)(?=\\s?\\d+)",
        replacement: "耶利米書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(哀)(?=\\s?\\d+)",
        replacement: "耶利米哀歌",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(結)(?=\\s?\\d+)",
        replacement: "以西結書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(但)(?=\\s?\\d+)",
        replacement: "但以理書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(何)(?=\\s?\\d+)",
        replacement: "何西阿書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(珥)(?=\\s?\\d+)",
        replacement: "約珥書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(摩)(?=\\s?\\d+)",
        replacement: "阿摩司書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(俄)(?=\\s?\\d+)",
        replacement: "俄巴底亞書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(拿)(?=\\s?\\d+)",
        replacement: "約拿書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(彌)(?=\\s?\\d+)",
        replacement: "彌迦書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(鴻)(?=\\s?\\d+)",
        replacement: "那鴻書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(哈)(?=\\s?\\d+)",
        replacement: "哈巴谷書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(番)(?=\\s?\\d+)",
        replacement: "西番雅書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(該)(?=\\s?\\d+)",
        replacement: "哈該書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(亞)(?=\\s?\\d+)",
        replacement: "撒迦利亞書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(瑪)(?=\\s?\\d+)",
        replacement: "瑪拉基書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(太)(?=\\s?\\d+)",
        replacement: "馬太福音",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(可)(?=\\s?\\d+)",
        replacement: "馬可福音",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(路)(?=\\s?\\d+)",
        replacement: "路加福音",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(約)(?=\\s?\\d+)",
        replacement: "約翰福音",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(徒)(?=\\s?\\d+)",
        replacement: "使徒行傳",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(羅)(?=\\s?\\d+)",
        replacement: "羅馬書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(林前)(?=\\s?\\d+)",
        replacement: "哥林多前書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(林後)(?=\\s?\\d+)",
        replacement: "哥林多後書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(加)(?=\\s?\\d+)",
        replacement: "加拉太書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(弗)(?=\\s?\\d+)",
        replacement: "以弗所書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(腓)(?=\\s?\\d+)",
        replacement: "腓立比書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(西)(?=\\s?\\d+)",
        replacement: "歌羅西書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(帖前)(?=\\s?\\d+)",
        replacement: "帖撒羅尼迦前書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(帖後)(?=\\s?\\d+)",
        replacement: "帖撒羅尼迦後書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(提前)(?=\\s?\\d+)",
        replacement: "提摩太前書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(提後)(?=\\s?\\d+)",
        replacement: "提摩太後書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(多)(?=\\s?\\d+)",
        replacement: "提多書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(門)(?=\\s?\\d+)",
        replacement: "腓利門書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(來)(?=\\s?\\d+)",
        replacement: "希伯來書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(雅)(?=\\s?\\d+)",
        replacement: "雅各書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(彼前)(?=\\s?\\d+)",
        replacement: "彼得前書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(彼後)(?=\\s?\\d+)",
        replacement: "彼得後書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(約一)(?=\\s?\\d+)",
        replacement: "約翰一書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(約二)(?=\\s?\\d+)",
        replacement: "約翰二書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(約三)(?=\\s?\\d+)",
        replacement: "約翰三書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(猶)(?=\\s?\\d+)",
        replacement: "猶大書",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    },
    {
        original: "(?<![\\u4e00-\\u9fa5])(啟)(?=\\s?\\d+)",
        replacement: "啟示錄",
        isRegex: true, matchType: 'regex',
        applyBeforeGlobal: false,
        language: 'zh'
    }
];
