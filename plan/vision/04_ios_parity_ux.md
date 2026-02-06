# UX: iOS Full Parity

**PRD:** [04_ios_parity_prd.md](04_ios_parity_prd.md)

## iOS-Native Patterns

| Android | iOS Equivalent |
|---------|----------------|
| Bottom nav drawer | Tab bar |
| FAB | Primary toolbar button |
| Back gesture (left edge) | iOS swipe-back |
| Toast | iOS-style toast |

## Widget Design

**Reading Progress Widget**
```
┌─────────────────────────┐
│ 📖 Dune                 │
│ ━━━━━━━━━░░░░░░ 42%     │
│ ~3 hours left           │
└─────────────────────────┘
```

## Siri Shortcuts

- "Read my book" → Resume current
- "Continue [book name]" → Open specific
- "How much have I read today?" → Stats

## CarPlay Layout

```
┌─────────────────────────────────────┐
│  📖 Dune                            │
│  Chapter 14: The Sleeper Must...    │
│                                     │
│  [⏮]    [⏯]    [⏭]                │
│  -15s           +15s                │
│                                     │
│  [1x ▾]              [😴 Sleep]     │
└─────────────────────────────────────┘
```
