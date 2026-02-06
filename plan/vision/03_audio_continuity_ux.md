# UX: Universal Audio Continuity

**PRD:** [03_audio_continuity_prd.md](03_audio_continuity_prd.md)

## Handoff Flow

### Device A → Device B

1. User stops on Device A (or switches audio output)
2. Device A writes position to Yjs
3. Device B shows notification: "Continue 'Dune' from 42:15?"
4. Tap → Resumes instantly

### Auto-Handoff (Bluetooth)

1. Phone connected to car Bluetooth
2. App detects audio focus transfer
3. Auto-resumes on car stereo (if setting enabled)
4. Phone shows "Playing on [Car Name]"

## Quick Resume Widget

```
┌────────────────────────────────────┐
│  📖 Dune - Chapter 14              │
│  ━━━━━━━━━━━━━━━░░░░░ 42%          │
│  [▶ Resume]           Phone • 2m ago│
└────────────────────────────────────┘
```

## Device History

Settings → Sync → Devices
- List of known devices with last activity
- "Reading on: Phone (now)"
- "Last: Tablet (2 hours ago)"

## Conflict State

If position differs by >30 seconds:
"Pick up where you left off?"
- [Phone: Ch 14, 42:15]
- [Tablet: Ch 14, 38:02]
