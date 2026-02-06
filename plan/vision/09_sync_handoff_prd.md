# PRD: Advanced Sync & Handoff

**Status:** Draft | **Priority:** Incremental | **Category:** Infrastructure

## 1. Problem Statement

Current sync works but has friction:
- 2-second delay for progress sync
- Ghost books require manual file import
- Conflict indicators unclear
- No visual handoff cues

## 2. Vision

**Invisible, instant sync**:
- Sub-second progress updates
- Automatic conflict resolution
- Clear status indicators
- One-tap handoff between devices

## 3. Features

### P0 (MVP)
- [ ] Reduce sync latency to <500ms
- [ ] Improve conflict UX (clear resolution)
- [ ] "Open on other device" action

### P1 (Enhancement)
- [ ] Push notifications for handoff
- [ ] Sync status dashboard
- [ ] Manual export/import improvements

### P2 (Delight)
- [ ] "Where was I reading?" across devices
- [ ] Device activity timeline
- [ ] Storage usage per device

## 4. Technical Improvements

| Current | Target |
|---------|--------|
| 2s Firestore debounce | 250ms debounce |
| Full doc sync | Delta-only sync |
| Manual conflict UI | Auto-resolve with toast |
| No handoff | Cross-device notifications |

## 5. Sync Status Visibility

| State | Indicator |
|-------|-----------|
| Synced | ✓ Green |
| Syncing | ⟳ Animated |
| Offline | ⚡ Yellow |
| Conflict | ⚠ Red |

---

*References: [09_sync_handoff_ux.md](09_sync_handoff_ux.md)*
