# PRD: Personal Reading Analytics

**Status:** Draft | **Priority:** Incremental | **Category:** Insights

## 1. Problem Statement

Users lack visibility into their reading habits:
- How much do I actually read?
- When am I most productive?
- How long until I finish this book at current pace?
- Am I making progress on reading goals?

## 2. Vision

**Personal reading insights** (not social comparison):
- Daily/weekly/monthly reading stats
- Reading velocity trends
- Time-of-day patterns
- Goal tracking with projections

## 3. Features

### P0 (MVP)
- [ ] Reading time today/this week
- [ ] Books finished this year
- [ ] Reading streak tracker

### P1 (Enhancement)
- [ ] Reading goals (books/year, pages/day)
- [ ] Finish date predictions
- [ ] Best reading times analysis

### P2 (Delight)
- [ ] Annual reading report
- [ ] Genre distribution
- [ ] Listening vs reading balance

## 4. Multi-Device Considerations

- All stats aggregate from **all devices**
- Time zone normalization
- Reading session attribution by device

## 5. Privacy

- All analytics computed **locally**
- Syncs via Yjs (user's own data)
- No aggregation to any server
- Exportable as personal data

---

*References: [08_analytics_ux.md](08_analytics_ux.md)*
