# PRD: Native Audiobook Support

**Status:** Draft | **Priority:** Major | **Category:** Content

## 1. Problem Statement

Users have two audio libraries:
- TTS-converted EPUBs (Versicle)
- Pre-recorded audiobooks (M4B/MP3, elsewhere)

This fragments the listening experience and library management.

## 2. Vision

**One app for all your audio books**:
- Import M4B, M4A, MP3 audiobooks
- Same library, same sync, same controls
- Seamless switching between TTS and recorded audio
- Optional: Pair EPUB with audiobook (Whispersync-like)

## 3. Target User

**Single user** who owns both EPUBs and audiobooks and wants unified management.

## 4. Proposed Features

### P0 (MVP)
- [ ] M4B import and playback
- [ ] Chapter detection from metadata
- [ ] Progress syncs across devices
- [ ] Same player controls as TTS

### P1 (Enhancement)
- [ ] MP3 folder import
- [ ] EPUB + audio pairing
- [ ] Switch between text and audio mid-book

### P2 (Delight)
- [ ] Audio quality enhancement
- [ ] Transcript generation from audio
- [ ] Speed normalization across books

## 5. Success Metrics

| Metric | Target |
|--------|--------|
| Audiobook imports | 10% of library |
| Cross-device playback | Works reliably |
| User satisfaction | "Unified library" sentiment |

## 6. Storage Considerations

- Audio files stay **local** (not synced to cloud)
- Only metadata + progress syncs via Yjs
- Large file streaming from IndexedDB

---

*References: [05_audiobook_native_ux.md](05_audiobook_native_ux.md)*
