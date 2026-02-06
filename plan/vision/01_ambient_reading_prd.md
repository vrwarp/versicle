# PRD: Ambient Reading Intelligence

**Status:** Draft | **Priority:** Moonshot | **Category:** Context Adaptation

## 1. Problem Statement

Reading context varies dramatically:
- **Morning commute**: Quick TTS on phone, noisy environment
- **Evening relaxation**: Visual reading on tablet, calm setting
- **Late night**: Reduced blue light, sleep timer needed
- **Car**: TTS-only, simplified controls
- **Office break**: Discrete reading, silent mode

Users manually adjust settings for each context. This friction reduces reading time.

## 2. Vision

Versicle **automatically adapts** to your context:
- Time of day → Theme, font warmth, brightness
- Device type → UI density, interaction mode
- Location → TTS vs visual, volume
- Motion → Car mode detection
- Ambient light → Contrast adjustments

## 3. Target User

**Single user** who reads across multiple devices and contexts throughout the day.

## 4. Proposed Features

### P0 (MVP)
- [ ] Time-based theme profiles (morning/day/evening/night)
- [ ] Per-device default settings
- [ ] Car mode auto-detection (Bluetooth + motion)

### P1 (Enhancement)
- [ ] Location-based profiles (Home, Office, Commute)
- [ ] Learning: Adapt based on user behavior patterns
- [ ] Quick profile switching widget

### P2 (Delight)
- [ ] Sleep schedule integration (bedtime mode)
- [ ] Ambient light sensor adaptation
- [ ] Calendar awareness ("meeting in 10 min" → bookmark)

## 5. Success Metrics

| Metric | Target |
|--------|--------|
| Setting changes per session | -50% |
| Context detection accuracy | >90% |
| User satisfaction | +15% NPS |
| Reading time per day | +10% |

## 6. Privacy Considerations

- All context detection happens **on-device**
- No location data sent to servers
- User can disable any sensor
- Transparent: "Detected: Evening mode"

## 7. Dependencies

- Device sensors (ambient light, motion)
- Bluetooth state detection
- Optional: Location services (user opt-in)

---

*References: [01_ambient_reading_ux.md](01_ambient_reading_ux.md)*
