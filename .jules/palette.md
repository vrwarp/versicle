## 2025-05-20 - Standardizing Touch Targets with UI Components

**Context:** The Reader View toolbar used raw HTML `<button>` elements with inconsistent styling and small touch targets (often effectively 36px or dependent on padding).

**Learning:**
- Replacing raw buttons with the design system's `Button` component (`size="icon"`) standardizes the touch target to 40px, which is closer to the 44px mobile target recommendation.
- It automatically provides accessible focus rings and keyboard interaction states.
- Visual consistency (e.g., `rounded-full`) can be maintained via `className` overrides on the standard component, allowing us to keep the design intent while improving UX and accessibility.

## 2025-02-14 - Active Mode Playback Indicators
**Learning:** In minimal UI states like "Active Mode" where actions are merged with information display, users often miss the interactivity. Text-only targets (like "Chapter 1") are ambiguous.
**Action:** When merging status and action, always provide a persistent icon (like Play/Pause) alongside the text label to signify both state and interactivity, even if space is tight.
