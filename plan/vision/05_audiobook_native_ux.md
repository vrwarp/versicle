# UX: Native Audiobook Support

**PRD:** [05_audiobook_native_prd.md](05_audiobook_native_prd.md)

## Import Flow

1. Drop M4B file on library / File picker
2. Progress: "Importing audiobook..."
3. Cover extracted, chapters detected
4. Badge: 🎧 "Audiobook" on card

## Audiobook Player

```
┌─────────────────────────────┐
│      [Book Cover]           │
│                             │
│    Chapter 14: The Cave     │
│    ━━━━━━━━━━░░░░░ 42:15    │
│                             │
│   [⏮ 15s] [⏯] [15s ⏭]      │
│                             │
│   [1.0x ▾]    [📑 Chapters] │
│              [😴 Sleep]     │
└─────────────────────────────┘
```

## EPUB + Audiobook Pairing

If both exist:
- Library shows single entry with toggle
- "Switch to text" / "Switch to audio"
- Position syncs between modes

## Storage Indicator

Library → Book → Info
"Audio: 340 MB (stored locally)"
"Remove audio" option keeps EPUB
