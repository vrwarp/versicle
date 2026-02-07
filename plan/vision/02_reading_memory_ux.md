# UX: Personal Reading Memory

**PRD:** [02_reading_memory_prd.md](02_reading_memory_prd.md)

## Entry Points

1. **Selection menu**: "Ask about this" on highlighted text
2. **Floating button**: Companion icon in reader
3. **Book menu**: "Summarize so far"
4. **Library search**: "Find where I read about X"

## Companion Panel (Side Sheet)

```
┌─────────────────────────────────┐
│  📚 Reading Companion           │
├─────────────────────────────────┤
│  [Chat] [Characters] [Summary]  │
├─────────────────────────────────┤
│                                 │
│  You: Who is Paul's mother?     │
│                                 │
│  AI: Lady Jessica is Paul's     │
│  mother, a Bene Gesserit who... │
│  (Ch 2, p.14)                   │
│                                 │
├─────────────────────────────────┤
│  [ Ask a question...        🎤] │
└─────────────────────────────────┘
```

## Spoiler Handling

- Default: Only answers from content before current position
- Toggle: "I've finished this book"
- Warning before revealing future content

## Cross-Book Search

Library → Search → "Across all books"
Results show: Book, location, context snippet
