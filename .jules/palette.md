## 2024-04-20 - Focus Ring Consistency
**Learning:** Radix UI primitives and custom components often inherit standard `focus:` tailwind states, which causes focus rings to persist after mouse clicks. Using `focus-visible:` ensures outlines only appear during keyboard navigation, improving visual UX while maintaining full a11y compliance.
**Action:** Always prefer `focus-visible:` over `focus:` for focus rings in interactive elements, and verify new components default to this pattern.
