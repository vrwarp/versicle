# PRD: Personal Reading Memory

**Status:** Draft | **Priority:** Moonshot | **Category:** AI/Personal

## 1. Problem Statement

Your reading history is fragmented:
- Finished books fade from memory
- Characters/plots blur across series
- Can't recall where you read a concept
- No way to connect themes across books

A personal reading assistant should **know everything you've read**.

## 2. Vision

An AI companion with **complete memory** of your reading:
- "Who was that character in the third book?"
- "Where did I read about X concept?"
- "Summarize my reading on topic Y across all books"
- "What books have I read by this author?"

Unlike generic AI, this knows **your specific** highlights, annotations, and reading patterns.

## 3. Target User

**Single user** building a personal knowledge base through reading.

## 4. Proposed Features

### P0 (MVP)
- [ ] Per-book AI Q&A (spoiler-aware)
- [ ] "Summarize where I left off"
- [ ] Character/term glossary generation

### P1 (Enhancement)
- [ ] Cross-book search ("Where did I read about...")
- [ ] Theme tracking across library
- [ ] Reading pattern insights

### P2 (Delight)
- [ ] "Based on what you've read, you might like..."
- [ ] Personal reading report (annual/monthly)
- [ ] Export knowledge graph

## 5. Success Metrics

| Metric | Target |
|--------|--------|
| Q&A queries per active user | 2+/week |
| Answer helpfulness | >85% positive |
| Return-to-book rate | +20% |
| Books finished | +10% |

## 6. Privacy Considerations

- All processing can be **local-first** (on-device models)
- Cloud AI optional with explicit consent
- Reading data never leaves user's Yjs doc
- No training on user data

## 7. Technical Approach

- Gemini Nano for on-device (Android)
- Gemini Flash for cloud (optional)
- RAG over user's annotations + highlights
- Embeddings stored locally in IndexedDB

---

*References: [02_reading_memory_ux.md](02_reading_memory_ux.md)*
