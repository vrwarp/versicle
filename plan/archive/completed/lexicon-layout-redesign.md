Design Document: Pronunciation Lexicon Layout Redesign

1. Problem Statement

The Issue

In the current implementation of the LexiconManager component, pronunciation rules are displayed in a grid layout with two equal-width columns (grid-cols-2).

When a user defines a Regular Expression (Regex) rule, the pattern string often exceeds the visual width allocated to the left column. Because the text overflow is unconstrained, the regex string renders directly on top of the "Replacement" text in the right column.

User Impact

Illegibility: The overlapping text creates a visual mesh that makes both the input pattern and the output pronunciation unreadable.

Loss of Trust: The broken UI signals a lack of polish, potentially causing users to doubt the reliability of the underlying text-to-speech engine.

Scanning Failure: Users cannot quickly scan the list to find specific rules because the visual anchors are obscured.

Constraints

Variable Length Data: Regex patterns can be very short (\bHi\b) or extremely long (\b(Matt|Mark|Luke|John|Acts|Rom|...)\b).

Mobile-First Context: The application (Versicle) runs on mobile devices where horizontal screen real estate is strictly limited.

Technical Audience: Users utilizing Regex features expect precision and clarity, not simplification.

2. UX Design: The "Vertical Logic Block"

Core Concept

We will shift the mental model from a "Table Row" (comparison) to a "Logic Block" (transformation).

Instead of forcing the Trigger (Regex) and the Effect (Pronunciation) to share horizontal space, we will stack them vertically. This treats the regex as a definition and the replacement as the resulting output.

Visual Hierarchy

1. The Trigger (Top Line)

Content: The Regex pattern or source word.

Styling: Monospace font (font-mono). This is critical for Regex readability, allowing users to distinguish between similar characters (e.g., |, l, 1, .).

Badges: "Regex" and "High Priority" badges remain on this line, preceding the text, to categorize the rule type immediately.

Overflow: Text is allowed to wrap to new lines (break-all). We prioritize showing the entire pattern over maintaining a fixed row height.

2. The Effect (Bottom Line)

Content: The replacement text (how it should be pronounced).

Styling: Sans-serif, bold, or slightly darker text color to denote "Human Readable."

Connector: An icon (specifically CornerDownRight from Lucide) is placed at the start of this line.

Purpose: This arrow creates a visual indentation and implies a flow of logic: "If this matches, then do this."

Mockup Representation

Current (Broken):

[REGEX] \b(1|2|3) J[Replacement Text]hn


Proposed (Vertical Stack):

[REGEX] [PRE] \b(1|2|3) John\b
      ↳ First, Second, or Third John


3. Technical Implementation Details

Component: LexiconManager.tsx

We are modifying the rendering loop within the rules.map function.

A. Layout Structure Change

From: CSS Grid (grid grid-cols-2)
To: Flex Column (flex flex-col)

The container for the rule display will lose its rigid grid constraints. By switching to a vertical flex layout, we decouple the width of the Regex from the width of the Replacement. The Regex can now consume 100% of the container width before wrapping.

B. Handling Text Overflow

We must ensure that even in a vertical stack, a malicious or accidentally massive regex string does not break the layout container width.

Strategy: Apply break-all to the regex text span.

Why: Standard break-words might fail if the regex is a continuous string of characters without spaces (e.g., (a|b|c|d|e|f|g|h|...)). break-all forces a line break at any character to prevent horizontal scrolling or overflow.

C. Iconography & Visual Cues

We will introduce the CornerDownRight icon.

Color/Opacity: The icon should be subtle (e.g., text-gray-400 or opacity-50). It is a guide, not primary data.

Spacing: A small left margin or padding ensures the "Effect" line feels indented relative to the "Trigger" line, reinforcing the hierarchy.

D. Edit Mode Considerations

The "Edit Mode" (when a user clicks "Edit") currently uses a horizontal layout for inputs.

Decision: For consistency and mobile usability, the Edit Mode inputs should also be stacked vertically in the final implementation, matching the viewing state. However, for this immediate fix, the priority is resolving the display overlap in the list view.

CSS/Tailwind Class Strategy

Container: flex flex-col gap-1 min-w-0 py-1

min-w-0 is a crucial Flexbox hack that allows children to shrink/truncate properly inside a flex item.

Regex Span: font-mono text-sm break-all

Replacement Container: flex items-center gap-2 pl-1

Replacement Text: font-semibold text-gray-800

4. Benefits Summary

Robustness: The layout is now immune to content length. Whether the regex is 5 characters or 500, the UI adapts gracefully by growing vertically.

Mobile Compatibility: This pattern is natively responsive. It utilizes the full width of the phone screen for the complex regex pattern, making it easier to tap and read.

Cognitive Clarity: Separating the "Computer Code" (Regex) from the "Human Speech" (Replacement) helps the user switch contexts between debugging patterns and verifying pronunciation.

5. Implementation & Verification Log

**Status**: Completed

**Actions Taken**:
1.  Modified `LexiconManager.tsx` to switch from `grid-cols-2` to `flex flex-col` for rule display.
2.  Applied `break-all` to the original text (regex) span to ensure wrapping of long patterns.
3.  Added `CornerDownRight` icon from `lucide-react` to visually indicate the replacement text.
4.  Updated the "Edit Mode" and "Add Mode" interfaces to also stack inputs vertically, ensuring UI consistency and better space utilization on mobile.
5.  Verified the layout using a custom Playwright script (`verification/verify_lexicon_script.py`) which confirmed elements are visible and structure is correct. A screenshot (`verification/lexicon_layout.png`) was captured to visually confirm the fix.

**Deviations**:
-   The "Edit Mode" inputs were also updated to stack vertically, which was suggested as a "final implementation" goal in section 3.D but was implemented immediately for consistency.
-   The container for the regex line uses `items-center` which might center the badge vertically if the regex wraps to multiple lines. A review suggestion recommended `items-start` or `items-baseline` to align the badge with the first line. This will be addressed in the final polish.

**Discoveries**:
-   The `break-all` class is essential for regex patterns as they often lack whitespace.
-   Vertical stacking significantly improves readability for even moderately long patterns.
