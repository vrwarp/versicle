# PRD: iOS Full Parity

**Status:** Draft | **Priority:** Major | **Category:** Platform

## 1. Problem Statement

iOS users are second-class citizens:
- PWA lacks background audio reliability
- No App Store presence
- Missing native integrations (Shortcuts, Widgets)
- iCloud not available as sync option

Multi-device requires **iOS full parity**.

## 2. Vision

Versicle on iOS should be **indistinguishable** from Android:
- Every feature works identically
- Native performance and feel
- Full iOS ecosystem integration
- App Store distribution

## 3. Feature Parity Checklist

| Feature | Android | iOS Target |
|---------|---------|------------|
| EPUB reading | ✅ | ✅ |
| TTS playback | ✅ | ✅ |
| Background audio | ✅ | ✅ |
| Lock screen controls | ✅ | ✅ |
| Cross-device sync | ✅ | ✅ |
| Offline support | ✅ | ✅ |

## 4. iOS-Specific Additions

### P0 (Launch)
- [ ] App Store submission
- [ ] Background audio modes
- [ ] Files app integration
- [ ] iCloud sync option

### P1 (Enhancement)
- [ ] iPad split-view
- [ ] Siri Shortcuts
- [ ] Widgets (reading progress)
- [ ] Handoff to Mac

### P2 (Delight)
- [ ] Apple Watch controls
- [ ] CarPlay
- [ ] Dynamic Island (playing indicator)

## 5. Success Metrics

| Metric | Target |
|--------|--------|
| iOS crash rate | <0.5% |
| Feature parity | 100% |
| App Store rating | >4.5 |
| iOS user adoption | 40% of mobile users |

---

*References: [04_ios_parity_ux.md](04_ios_parity_ux.md)*
