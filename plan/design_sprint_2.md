UX Improvement Task Tracker

🚨 Sprint 1: Readability & Core Experience (High Priority)

[CSS] Enforce Optimal Line Length

Context: Lines currently span the full viewport width, causing eye fatigue.
Requirements:

[ ] Apply a max-width constraint (approx 65ch or max-w-2xl) to the text container in ReaderView.tsx.

[ ] Ensure the container is horizontally centered (mx-auto).

[ ] Verify this applies correctly to both Serif and Monospace font selections.

[CSS] Increase Mobile Reading Padding

Context: Text runs dangerously close to the bezel on mobile devices.
Requirements:

[ ] Increase horizontal padding to px-6 or px-8 on standard breakpoints.

[ ] Ensure header and footer controls respect this same padding alignment.

[Feat] Immersive Mode Toggle

Context: Persistent UI chrome distracts from long-form reading.
Requirements:

[ ] Implement a click handler on the central reading area.

[ ] Tapping center should toggle visibility of the Top Navigation Bar and Bottom Control Bar.

[ ] Tapping center again should restore them.

[ ] Constraint: Do not trigger this when highlighting text or clicking links.

🚀 Sprint 2: Onboarding & First Impression

[UI] Create EmptyLibrary Component

Context: New users see a blank screen with small "Empty" text.
Requirements:

[ ] Create src/components/library/EmptyLibrary.tsx.

[ ] Add a centered layout with a friendly illustration (SVG/Icon).

[ ] Add a prominent primary button: "Import EPUB".

[ ] Add a secondary text link: "Load Demo Book (Alice in Wonderland)".

[Logic] Wire Up Empty State

Context: The Library view needs to switch modes based on content.
Requirements:

[ ] In LibraryView.tsx, check if books.length === 0.

[ ] If 0, render <EmptyLibrary /> instead of the empty grid.

[UI] Standardize Book Card Dimensions

Context: Book covers have varying aspect ratios, breaking the grid layout.
Requirements:

[ ] Enforce a strict aspect ratio (e.g., aspect-[2/3]) on the BookCard image container.

[ ] Use object-cover for the image fit.

[ ] Add shadow-sm and hover:shadow-md transitions to the card container.

[UI] Upgrade Library Header Actions

Context: The "Upload" button is hard to find.
Requirements:

[ ] Replace the text "Upload" button with a primary Icon Button (Plus/Add icon) in the top right.

[ ] Ensure the tap target is at least 44x44px.

🎧 Sprint 3: Audio & TTS Refinement

[UI] Clean Up TTS Queue List

Context: The current queue looks like a debug log.
Requirements:

[ ] Open TTSQueue.tsx.

[ ] Remove displayed fields: "Cached: Yes/No", "Char count", "Cost".

[ ] Increase the font size of the text snippet.

[ ] Group snippets visually if they belong to the same paragraph (optional).

[UI] Active Sentence Highlighting

Context: Users lose their place in the queue.
Requirements:

[ ] Visually distinguish the currently playing segment.

[ ] Style: Use a darker text color / lighter background for active.

[ ] Style: Dim (reduce opacity to ~0.6) all pending and completed segments.

[Feat] Expanded Audio Controls

Context: Play/Pause is insufficient for audiobooks.
Requirements:

[ ] Add "Skip Back 15s" button.

[ ] Add "Skip Forward 15s" button.

[ ] Ensure these buttons are large enough for thumb use.

[Refactor] Relocate Cost Indicator

Context: Floating cost ticker causes user anxiety.
Requirements:

[ ] Remove the floating cost overlay from ReaderView.

[ ] Move the session cost display to the TTS Settings panel or a dedicated "Usage" modal.

💎 Sprint 4: Polish & Hierarchy

[UI] Group Settings Menu

Context: Settings are a flat, confusing list.
Requirements:

[ ] Create a SettingsSectionHeader component (small caps, gray text).

[ ] Group existing settings in ReaderSettings.tsx into:

Display: Theme, Font, Size, Line Height.

Audio: Voice, Speed, Stability.

System: Storage, Reset.

[UI] Improve Search Result Readability

Context: It is unclear why a search result matched.
Requirements:

[ ] In SearchPanel (or equivalent), process the snippet text.

[ ] Wrap the matching search term in <strong> or <span class="bg-yellow-100"> tags.

[UI] Annotation Popover Touch Targets

Context: "Highlight" and "Note" buttons are too small.
Requirements:

[ ] Increase padding on popover buttons.

[ ] Add icons to the buttons (Pen for Note, Marker for Highlight) to improve scanning speed.

[UX] Auto-Scroll Table of Contents

Context: Opening TOC always starts at the top of the book.
Requirements:

[ ] When TOC drawer opens, calculate which chapter is currently visible.

[ ] Automatically scrollIntoView that chapter item so the user knows where they are.
