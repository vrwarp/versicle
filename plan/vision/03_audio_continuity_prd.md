# PRD: Universal Audio Continuity

**Status:** Draft | **Priority:** Moonshot | **Category:** Multi-Device

## 1. Problem Statement

Audio handoff is broken:
- Start listening on phone → Drive arrives → Audio stops
- Want to continue on car stereo → Must manually restart
- Switch to home speaker → Lose position
- Resume on different device → Awkward seeking

True continuity requires **zero-friction audio handoff**.

## 2. Vision

**"AirPods for reading"** - Your audiobook follows you:
- Phone → Car: Automatic handoff via Bluetooth
- Car → Home: Continue on smart speaker
- Any device: Resume exactly where you stopped
- Instant sync: Sub-second position accuracy

## 3. Target User

**Single user** who listens across multiple audio output devices throughout the day.

## 4. Proposed Features

### P0 (MVP)
- [ ] Sub-second progress sync (current: ~2s)
- [ ] Audio focus detection (pause on phone when car takes over)
- [ ] Quick-resume widget on each device

### P1 (Enhancement)
- [ ] Bluetooth device memory (Car = auto-play)
- [ ] Android Auto / CarPlay integration
- [ ] "Continue listening" notification on other devices

### P2 (Delight)
- [ ] Apple Watch controls (play/pause, skip)
- [ ] Wear OS controls
- [ ] Home Assistant integration
- [ ] "Cast to" for smart speakers

## 5. Success Metrics

| Metric | Target |
|--------|--------|
| Handoff success rate | >95% |
| Position sync latency | <500ms |
| Cross-device listening sessions | 30% of users |
| Audio session completion | +15% |

## 6. Technical Challenges

| Challenge | Approach |
|-----------|----------|
| Sub-second sync | Debounced Firestore writes, optimistic local updates |
| Audio focus | Native audio session management |
| Bluetooth detection | Capacitor plugin for device profiles |
| Background reliability | Foreground service (Android), Background modes (iOS) |

## 7. Privacy

- No audio content synced to cloud
- Only position/timestamp sync
- Device list stored locally
- Bluetooth pairing stays on-device

---

*References: [03_audio_continuity_ux.md](03_audio_continuity_ux.md)*
