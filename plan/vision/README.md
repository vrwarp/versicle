# Versicle Vision: Single-User, Multi-Device Excellence

The core premise: **One person, all their devices, seamless reading.**

This directory contains Product Requirements Documents (PRDs) and UX Requirements for future features focused exclusively on deepening the single-user experience across multiple devices.

---

## Core Philosophy

> Versicle should feel like a personal reading companion that follows you everywhere—phone, tablet, car, watch, desktop—adapting to each context while maintaining perfect continuity.

**Not in scope:** Social features, sharing, multi-user, community features. Those dilute focus.

---

## Vision Categories

### 🚀 Moonshots
| # | Feature | Focus | Docs |
|---|---------|-------|------|
| 01 | **Ambient Reading Intelligence** | Context-aware adaptation (time, location, device) | [PRD](01_ambient_reading_prd.md) / [UX](01_ambient_reading_ux.md) |
| 02 | **Personal Reading Memory** | AI that knows your entire reading history | [PRD](02_reading_memory_prd.md) / [UX](02_reading_memory_ux.md) |
| 03 | **Universal Audio Continuity** | Seamless TTS handoff between all devices | [PRD](03_audio_continuity_prd.md) / [UX](03_audio_continuity_ux.md) |

### 🌟 Major Features
| # | Feature | Focus | Docs |
|---|---------|-------|------|
| 04 | **iOS Full Parity** | Complete the multi-device story | [PRD](04_ios_parity_prd.md) / [UX](04_ios_parity_ux.md) |
| 05 | **Native Audiobook Support** | Your entire audio library, one app | [PRD](05_audiobook_native_prd.md) / [UX](05_audiobook_native_ux.md) |
| 06 | **Device-Optimized Experiences** | Right UX for each form factor | [PRD](06_device_optimized_prd.md) / [UX](06_device_optimized_ux.md) |

### 🔧 Incremental Improvements
| # | Feature | Focus | Docs |
|---|---------|-------|------|
| 07 | **TTS v2 Completion** | Premium listening on every device | [PRD](07_tts_v2_prd.md) / [UX](07_tts_v2_ux.md) |
| 08 | **Personal Reading Analytics** | Insights about your reading patterns | [PRD](08_analytics_prd.md) / [UX](08_analytics_ux.md) |
| 09 | **Advanced Sync & Handoff** | Instant, reliable device switching | [PRD](09_sync_handoff_prd.md) / [UX](09_sync_handoff_ux.md) |

---

## Device Ecosystem

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Phone     │  │   Tablet    │  │   Desktop   │
│  (reading   │  │  (primary   │  │  (library   │
│   + TTS)    │  │   reading)  │  │   mgmt)     │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       └────────────────┼────────────────┘
                        │
              ┌─────────┴─────────┐
              │   Yjs + Firestore │
              │   (Your Data)     │
              └─────────┬─────────┘
                        │
       ┌────────────────┼────────────────┐
       │                │                │
┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐
│    Watch    │  │     Car     │  │   Speaker   │
│  (controls) │  │  (TTS only) │  │  (future?)  │
└─────────────┘  └─────────────┘  └─────────────┘
```

---

## Pending Technical Plans

See parent `plan/` directory for TTS v2 implementation details.

