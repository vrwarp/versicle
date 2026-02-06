# UX: Ambient Reading Intelligence

**PRD:** [01_ambient_reading_prd.md](01_ambient_reading_prd.md)

## Context Detection Flow

1. App launch → System detects context
2. If context changed → Smooth transition animation
3. Toast: "Evening mode activated" (dismissable)
4. Settings remain overridable

## Time-Based Profiles

| Time | Theme | Font | TTS |
|------|-------|------|-----|
| 6am-9am | Light, bright | Crisp | Normal |
| 9am-6pm | User preference | — | — |
| 6pm-9pm | Warm sepia | Softer | Slightly slower |
| 9pm-12am | Dark, low blue | — | Sleep timer prompt |

## Car Mode UX

- Detection: Bluetooth + motion sensors
- Entry: "Start car mode?" (3s auto-confirm)
- Layout: 3 giant buttons (prev/play/next)
- Exit: Bluetooth disconnect or manual

## Settings Screen

```
Ambient Reading
├── Time-based themes: [On/Off]
├── Car mode: [Auto / Manual / Off]
├── Evening mode start: [6pm ▾]
└── Allow device override: [✓]
```
