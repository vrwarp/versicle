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
    "Rev.", "Rv.", "Revelation"
];

// Based on lexicon-bible.csv
export const BIBLE_LEXICON_RULES: Omit<LexiconRule, 'id' | 'created'>[] = [
    {
        original: "\\b(Gen|Ge|Gn)\\.?(?=\\s?\\d+)",
        replacement: "Genesis",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Ex|Exod|Exo)\\.?(?=\\s?\\d+)",
        replacement: "Exodus",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Lev|Le|Lv)\\.?(?=\\s?\\d+)",
        replacement: "Leviticus",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Num|Nu|Nm|Nb)\\.?(?=\\s?\\d+)",
        replacement: "Numbers",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Deut|De|Dt)\\.?(?=\\s?\\d+)",
        replacement: "Deuteronomy",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Josh|Jos|Jsh)\\.?(?=\\s?\\d+)",
        replacement: "Joshua",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Judg|Jdg|Jg|Jdgs)\\.?(?=\\s?\\d+)",
        replacement: "Judges",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Ruth|Rth|Ru)\\.?(?=\\s?\\d+)",
        replacement: "Ruth",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(1\\s?Sam|1\\s?Sa|1S|I\\s?Sa|1\\s?Sm|1Sa|I\\s?Sam|1Sam|I\\s?Samuel|1st\\s?Samuel|First\\s?Samuel)\\.?(?=\\s?\\d+)",
        replacement: "First Samuel",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(2\\s?Sam|2\\s?Sa|2S|II\\s?Sa|2\\s?Sm|2Sa|II\\s?Sam|2Sam|II\\s?Samuel|2nd\\s?Samuel|Second\\s?Samuel)\\.?(?=\\s?\\d+)",
        replacement: "Second Samuel",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(1\\s?Kings|1\\s?Kgs|1\\s?Ki|1K|I\\s?Kgs|1Kgs|I\\s?Ki|1Ki|I\\s?Kings|1st\\s?Kings|First\\s?Kings)\\.?(?=\\s?\\d+)",
        replacement: "First Kings",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(2\\s?Kings|2\\s?Kgs|2\\s?Ki|2K|II\\s?Kgs|2Kgs|II\\s?Ki|2Ki|II\\s?Kings|2nd\\s?Kings|Second\\s?Kings)\\.?(?=\\s?\\d+)",
        replacement: "Second Kings",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(1\\s?Chron|1\\s?Chr|1\\s?Ch|1Ch|I\\s?Chr|1Chr|I\\s?Ch|1Ch|I\\s?Chron|1Chron|I\\s?Chronicles|1st\\s?Chronicles|First\\s?Chronicles)\\.?(?=\\s?\\d+)",
        replacement: "First Chronicles",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(2\\s?Chron|2\\s?Chr|2\\s?Ch|2Ch|II\\s?Chr|2Chr|II\\s?Ch|2Ch|II\\s?Chron|2Chron|II\\s?Chronicles|2nd\\s?Chronicles|Second\\s?Chronicles)\\.?(?=\\s?\\d+)",
        replacement: "Second Chronicles",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Ezra|Ezr)\\.?(?=\\s?\\d+)",
        replacement: "Ezra",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Neh|Ne)\\.?(?=\\s?\\d+)",
        replacement: "Nehemiah",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Esth|Es)\\.?(?=\\s?\\d+)",
        replacement: "Esther",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Job|Jb)\\.?(?=\\s?\\d+)",
        replacement: "Job",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Ps|Pss|Psa|Psm)\\.?(?=\\s?\\d+)",
        replacement: "Psalms",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Prov|Pro|Pr|Prv)\\.?(?=\\s?\\d+)",
        replacement: "Proverbs",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Eccles|Eccl|Ecc|Ec)\\.?(?=\\s?\\d+)",
        replacement: "Ecclesiastes",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Song|Song\\s?of\\s?Sol|So|Cant)\\.?(?=\\s?\\d+)",
        replacement: "Song of Solomon",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Isa|Is)\\.?(?=\\s?\\d+)",
        replacement: "Isaiah",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Jer|Je|Jr)\\.?(?=\\s?\\d+)",
        replacement: "Jeremiah",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Lam|La|Lm)\\.?(?=\\s?\\d+)",
        replacement: "Lamentations",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Ezek|Eze|Ezk)\\.?(?=\\s?\\d+)",
        replacement: "Ezekiel",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Dan|Da|Dn)\\.?(?=\\s?\\d+)",
        replacement: "Daniel",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Hos|Ho)\\.?(?=\\s?\\d+)",
        replacement: "Hosea",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Joel|Jl)\\.?(?=\\s?\\d+)",
        replacement: "Joel",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Amos|Am)\\.?(?=\\s?\\d+)",
        replacement: "Amos",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Obad|Ob)\\.?(?=\\s?\\d+)",
        replacement: "Obadiah",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Jonah|Jnh|Jon)\\.?(?=\\s?\\d+)",
        replacement: "Jonah",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Mic|Mi)\\.?(?=\\s?\\d+)",
        replacement: "Micah",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Nah|Na)\\.?(?=\\s?\\d+)",
        replacement: "Nahum",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Hab|Hb)\\.?(?=\\s?\\d+)",
        replacement: "Habakkuk",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Zeph|Zep|Zp)\\.?(?=\\s?\\d+)",
        replacement: "Zephaniah",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Hag|Hg)\\.?(?=\\s?\\d+)",
        replacement: "Haggai",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Zech|Zec|Zc)\\.?(?=\\s?\\d+)",
        replacement: "Zechariah",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Mal|Ma|Ml)\\.?(?=\\s?\\d+)",
        replacement: "Malachi",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Matt|Mt)\\.?(?=\\s?\\d+)",
        replacement: "Matthew",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Mark|Mk|Mrk)\\.?(?=\\s?\\d+)",
        replacement: "Mark",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Luke|Lk|Lu)\\.?(?=\\s?\\d+)",
        replacement: "Luke",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(John|Jn|Jhn)\\.?(?=\\s?\\d+)",
        replacement: "John",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Acts|Ac)\\.?(?=\\s?\\d+)",
        replacement: "Acts",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Rom|Ro|Rm)\\.?(?=\\s?\\d+)",
        replacement: "Romans",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(1\\s?Cor|1\\s?Co|I\\s?Cor|1Cor|I\\s?Co|1Co|I\\s?Corinthians|1st\\s?Corinthians|First\\s?Corinthians)\\.?(?=\\s?\\d+)",
        replacement: "First Corinthians",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(2\\s?Cor|2\\s?Co|II\\s?Cor|2Cor|II\\s?Co|2Co|II\\s?Corinthians|2nd\\s?Corinthians|Second\\s?Corinthians)\\.?(?=\\s?\\d+)",
        replacement: "Second Corinthians",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Gal|Ga)\\.?(?=\\s?\\d+)",
        replacement: "Galatians",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Eph|Ep)\\.?(?=\\s?\\d+)",
        replacement: "Ephesians",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Phil|Php|Pp)\\.?(?=\\s?\\d+)",
        replacement: "Philippians",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Col|Co)\\.?(?=\\s?\\d+)",
        replacement: "Colossians",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(1\\s?Thess|1\\s?Th|I\\s?Thess|1Thess|I\\s?Th|1Th|I\\s?Thessalonians|1st\\s?Thessalonians|First\\s?Thessalonians)\\.?(?=\\s?\\d+)",
        replacement: "First Thessalonians",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(2\\s?Thess|2\\s?Th|II\\s?Thess|2Thess|II\\s?Th|2Th|II\\s?Thessalonians|2nd\\s?Thessalonians|Second\\s?Thessalonians)\\.?(?=\\s?\\d+)",
        replacement: "Second Thessalonians",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(1\\s?Tim|1\\s?Ti|I\\s?Tim|1Tim|I\\s?Ti|1Ti|I\\s?Timothy|1st\\s?Timothy|First\\s?Timothy)\\.?(?=\\s?\\d+)",
        replacement: "First Timothy",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(2\\s?Tim|2\\s?Ti|II\\s?Tim|2Tim|II\\s?Ti|2Ti|II\\s?Timothy|2nd\\s?Timothy|Second\\s?Timothy)\\.?(?=\\s?\\d+)",
        replacement: "Second Timothy",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Titus|Tit|Ti)\\.?(?=\\s?\\d+)",
        replacement: "Titus",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Philem|Phm)\\.?(?=\\s?\\d+)",
        replacement: "Philemon",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Heb|He)\\.?(?=\\s?\\d+)",
        replacement: "Hebrews",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(James|Jas|Jm)\\.?(?=\\s?\\d+)",
        replacement: "James",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(1\\s?Pet|1\\s?Pe|1\\s?Pt|I\\s?Pet|1Pet|I\\s?Pe|1Pe|I\\s?Pt|1Pt|I\\s?Peter|1st\\s?Peter|First\\s?Peter)\\.?(?=\\s?\\d+)",
        replacement: "First Peter",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(2\\s?Pet|2\\s?Pe|2\\s?Pt|II\\s?Pet|2Pet|II\\s?Pe|2Pe|II\\s?Pt|2Pt|II\\s?Peter|2nd\\s?Peter|Second\\s?Peter)\\.?(?=\\s?\\d+)",
        replacement: "Second Peter",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(1\\s?John|1\\s?Jn|1\\s?Jhn|1\\s?Jo|I\\s?John|1John|I\\s?Jn|1Jn|I\\s?Jo|1Jo|I\\s?John|1st\\s?John|First\\s?John)\\.?(?=\\s?\\d+)",
        replacement: "First John",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(2\\s?John|2\\s?Jn|2\\s?Jhn|2\\s?Jo|II\\s?John|2John|II\\s?Jn|2Jn|II\\s?Jo|2Jo|II\\s?John|2nd\\s?John|Second\\s?John)\\.?(?=\\s?\\d+)",
        replacement: "Second John",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(3\\s?John|3\\s?Jn|3\\s?Jhn|3\\s?Jo|III\\s?John|3John|III\\s?Jn|3Jn|III\\s?Jo|3Jo|III\\s?John|3rd\\s?John|Third\\s?John)\\.?(?=\\s?\\d+)",
        replacement: "Third John",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Jude|Jd)\\.?(?=\\s?\\d+)",
        replacement: "Jude",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(Rev|Rv|Revelation)\\.?(?=\\s?\\d+)",
        replacement: "Revelation",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "(?<=\\d:\\d{1,3})(–|-)(?=\\d{1,3})",
        replacement: " to ",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(v|vs|vv)\\.?(?=\\s?\\d+)",
        replacement: "verse",
        isRegex: true,
        applyBeforeGlobal: false
    },
    {
        original: "\\b(ch|chap)\\.?(?=\\s?\\d+)",
        replacement: "chapter",
        isRegex: true,
        applyBeforeGlobal: false
    }
];
