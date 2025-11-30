# UI Components

This directory contains reusable UI components built with Radix UI and Tailwind CSS.

## Common Variants

Many components (Button, Badge) share a common set of semantic variants to ensure visual consistency:

- **default**: Primary emphasis (e.g., solid background, light text).
- **secondary**: Secondary emphasis (e.g., muted background).
- **destructive**: Critical actions or errors (e.g., red background).
- **outline**: Low emphasis with a border.
- **ghost**: Minimal emphasis (transparent background, hover effect).

## Component Specifics

### Badge
Used for status indicators or tags.
- Variants: `default`, `secondary`, `destructive`, `outline`.

### Button
Interactive trigger elements.
- Variants: `default`, `secondary`, `destructive`, `outline`, `ghost`, `link`.
- `link`: Appears as a text link.

### Sheet
A side drawer component (wraps Radix UI Dialog).
- **side**: Controls placement (`top`, `bottom`, `left`, `right`). Default is `right`.

### Modal
A centered dialog component (wraps Radix UI Dialog).
- Standard modal behavior with backdrop.
