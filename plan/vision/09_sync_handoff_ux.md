# UX: Advanced Sync & Handoff

**PRD:** [09_sync_handoff_prd.md](09_sync_handoff_prd.md)

## Sync Status Indicator

Header bar shows:
- ✓ Synced (green, static)
- ⟳ Syncing (animated)
- ⚡ Offline (yellow)
- ⚠ Conflict (red, tap to resolve)

## Handoff Notification

On secondary device:
"Continue reading Dune on this device?"
[Continue] [Dismiss]

## Conflict Resolution

When same book edited on two offline devices:

```
┌─────────────────────────────────────┐
│  ⚠ Reading Position Conflict       │
│                                     │
│  Phone: Chapter 14, page 182        │
│  Tablet: Chapter 14, page 176       │
│                                     │
│  [Use Phone] [Use Tablet]           │
└─────────────────────────────────────┘
```

## Sync Settings

```
Settings → Sync
├── Sync method: [Firestore ▾]
├── Sync frequency: [Real-time ▾]
├── Devices: [3 connected →]
└── Data export: [Export now →]
```

## Quick Actions

Book menu → "Open on..."
- Phone
- Tablet
- Desktop (if web app open)
