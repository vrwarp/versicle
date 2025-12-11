# **Strategic Design Specification IV: The Chapter Compass Interface**

Status: Draft  
Context: Design Sprint 4  
Focus: Spatial Orientation, Structural Navigation, and Ergonomic Optimization in Audio Playback

## **1\. Design Philosophy: The Wayfinding Imperative and Cognitive Cartography**

The "Chapter Compass" conceptual framework addresses a specific, pervasive anxiety inherent to the consumption of long-form auditory media: *spatial disorientation*. In the realm of physical typography, the reader benefits from inherent proprioceptive feedback—the shifting weight of pages transferring from the right hand to the left hand provides a subconscious, tactile indication of narrative progress. Digital audio, by contrast, is abstract and amorphous, lacking these physical demarcations.

### **1.1 The Operational Deficit: "Headless" Navigation**

In the application's current architectural state, navigating away from the active ReaderView precipitates a "headless" state of operation. The user retains access to the auditory stream but forfeits all visual context regarding their locus within the work. Conventional media player paradigms, which treat audio as a singular, continuous stream of time (e.g., "14:02 / 56:00"), are deemed insufficient for literary content. Users do not conceptualize books as linear time signatures; rather, they conceptualize them in structural units: *Chapters, Parts, and Cantos*. The absence of this structural visibility induces "state separation," wherein the user feels untethered from the controlling logic of the application.

### **1.2 The Solution Paradigm: The Structural Compass**

The "Chapter Compass" interface prioritizes **structural location** over granular temporal metrics. It functions not merely as a remote control, but as a **Head-Up Display (HUD) for Narrative Position**, designed to resolve three critical user inquiries instantaneously:

1. **Locus Identification:** Within which structural subdivision (Chapter) is the playback currently situated?  
2. **Temporal Proximity:** What is the remaining duration of the current subdivision?  
3. **Navigational Vector:** By what mechanism may the user traverse to adjacent structural landmarks?

By answering these inquiries explicitly, the interface mitigates the cognitive load associated with background playback, allowing the user to engage in secondary tasks (e.g., library curation) without losing their narrative bearing.

## **2\. Component Architecture: The Dual-Float "Satellite" System**

To mitigate the risk of accidental input errors (Mode Errors) and to clarify the semantic distinction between "Navigation" (movement through the text) and "Ignition" (activation of the audio engine), the interface is bifurcated into two distinct, physically detached floating elements. This separation of concerns is critical for preventing the "fat-finger" phenomenon common in unified control strips.

### **2.1 Element A: The Compass Pill (Navigation & Orientation)**

* **Positional Coordinates:** Fixed at the bottom-center of the viewport (bottom-6), centered horizontally within the safe area constraints.  
* **Dimensional Specifications:** The element shall be expansive horizontally but constrained vertically to preserve screen real estate (h-14 or 56px). Inset margins (mx-4 or mx-8) ensure the element appears distinct from the device bezel.  
* **Visual Aesthetics (Glassmorphism):**  
  * **Backdrop:** High-strength gaussian blur (backdrop-filter: blur(16px)).  
  * **Surface:** Translucent fill (bg-background/80 or bg-zinc-900/60 in dark mode).  
  * **Border:** A sub-pixel, semi-transparent border (border: 1px solid rgba(255,255,255,0.08)) to define edges against complex backgrounds.  
  * **Shadow:** A soft, diffused drop shadow (shadow-lg) to establish Z-axis elevation.  
* **Functional Scope:** This element is exclusively responsible for displaying location data and facilitating lateral movement (scrubbing and chapter skipping). It contains no playback state toggles.

### **2.2 Element B: The Satellite FAB (Ignition & Transport)**

* **Positional Coordinates:** Fixed at the bottom-right quadrant, floating on a Z-plane superior to the Compass Pill. It is offset vertically to float *above* the pill's centerline (bottom-24, right-6), creating a "satellite" orbit effect.  
* **Dimensional Specifications:** Standardized Floating Action Button dimensions (w-14 h-14 or 56x56px) to ensure a compliant touch target size.  
* **Visual Aesthetics:** The element shall be rendered as a solid, fully opaque circle utilizing the system's Primary accent color (e.g., Indigo or Amber). A substantial, sharp drop shadow (shadow-xl) is required to denote its elevation above all other UI elements.  
* **Functional Scope:** This element is dedicated exclusively to the binary toggle of Play/Pause.  
* **Ergonomic Justification:** This placement localizes the primary interaction trigger directly under the natural resting position of the right thumb for the majority of users (Right-Hand Thumb Zone). This creates a "safe zone" for interaction, avoiding the "Reachability Danger Zone" at the top of the viewport while simultaneously keeping the control visually and spatially distinct from the textual data of the Pill.

### **2.3 The "Compass Rose" Internal Layout (The Pill)**

The internal architecture of the Compass Pill is arranged to facilitate bidirectional navigation. It employs **Dynamic Navigation Modes** based on the audio state.

*   **Mode A: Audio Navigation (Active)**
    *   **Trigger Condition:** `isPlaying == true`
    *   **Left Anchor:** `SkipBack` icon. Triggers "Previous Sentence/Time Skip".
    *   **Right Anchor:** `SkipForward` icon. Triggers "Next Sentence/Time Skip".

*   **Mode B: Structural Navigation (Idle)**
    *   **Trigger Condition:** `isPlaying == false`
    *   **Left Anchor:** `ChevronsLeft` icon. Triggers "Restart/Previous Chapter".
    *   **Right Anchor:** `ChevronsRight` icon. Triggers "Next Chapter".

* **Center: The "Narrative Box"**
  * **Primary Text (Top Line):** "CHAPTER 5" (Rendered in Small Caps, Bold weight, with wide tracking for legibility).
  * **Secondary Text (Bottom Line):** "-12:45 remaining" (Rendered in Monospaced numerals to prevent character width jitter during countdown).
  * **Ambient Progress Visualization:** A subtle, translucent progress fill (opacity 10-15%) advances horizontally across the background of this container, providing an ambient analog indicator of completion status.

### **2.4 Contextual Adaptability (The Library State)**

The system must exhibit context-aware behavior based on the active view to respect the user's focus.

*   **Reader Context (Active):** The full "Compass Rose" interface is presented as defined above, enabling navigation and transport control.
*   **Library Context (Passive):**
    *   **Compass Pill:** Transforms into a "Summary Status" mode. The lateral navigation zones (Chevrons) are suppressed. The central display expands to show: Book Title, Chapter Title, and Progress/Time Remaining.
    *   **Satellite FAB:** The Play/Pause button is suppressed (hidden). The system should not continue playback when navigating to the library; the interface reflects a "Monitoring" rather than "Driving" state.

## **3\. Interaction Design Protocols and Gestural Mechanics**

### **3.1 Primary Discrete Interactions (Touch Targets)**

* **Compass Pill Center Activation:** A tap event registered on the central text area triggers the expansion of the UnifiedAudioPanel (The Full Map View). This transition should be animated as a vertical expansion originating from the pill's coordinates.  
* **Satellite FAB Activation:** A tap event toggles the global isPlaying state.  
* **Peripheral Activation (Arrows):** Tap events on the extreme left or right edges of the Pill execute the structural navigation commands defined in Section 2.3.

### **3.2 Secondary Continuous Interactions (Gestures)**

* **Horizontal Kinetic Scrubbing (Pill Constraint):**  
  * *Action:* A horizontal drag gesture initiated within the Compass Pill.  
  * *Logic:* Dragging left or right performs fine-grain seeking within the current chapter (Sentence Seek).  
  * *Haptic Feedback:* As the seek head traverses sentence boundaries, the device shall emit discrete haptic "ticks" (low-duration vibration). This provides physical confirmation of movement without requiring visual fixation.  
  * *Constraint:* The gesture is coordinate-locked to the pill area; vertical deviation does not cancel the gesture, but the scrub ratio is determined by horizontal delta.  
* **Long Press Termination (Satellite FAB):**  
  * *Action:* A sustained press (\>800ms) on the Satellite FAB.  
  * *Logic:* This executes a "Stop" command rather than a "Pause" command, fully terminating the audio session, releasing audio resources, and unmounting the floating interface. This functions as the definitive "Kill Switch."

## **4\. Integration Logic and Data Binding**

### **4.1 State Management (useTTSStore)**

The component requires precise subscription to the global useTTSStore to derive its display logic:

* currentChapterIndex: Utilized to derive the ordinal identifier (e.g., "Chapter 5").  
* currentChapterTitle: Utilized to derive the nominal identifier (e.g., "Advice from a Caterpillar").  
* chapterProgress: A float value (0.0 \- 1.0) driving the width of the ambient background fill.  
* timeRemainingInChapter: A calculated value utilized for the monospaced countdown timer.

### **4.2 Z-Index Stratification Strategy**

To ensure visibility without occlusion of critical modals, the following Z-index hierarchy is mandated:

1. **Content Layer (Library/Settings):** z-0
2. **Navigation Chrome (Bottom Nav):** z-30
3. **Compass Pill:** z-40 (Must float above content but below full-screen overlays).
4. **Satellite FAB:** z-50 (Must float above the Pill and all other standard UI elements).  
5. **System Modals/Dialogs:** z-100 (Must obscure the player controls to prevent interaction during critical alerts).

### **4.3 Edge Case Handling**

* **Boundary Conditions:** If the user is situated in "Chapter 1" (Index 0), the Left Chevron must be rendered in a disabled state (reduced opacity, interaction suppression) to indicate the absence of anterior content. Similarly, the Right Chevron must be disabled at the final chapter.  
* **Metadata Sanity:** In instances where currentChapterTitle is undefined or null (e.g., poorly formatted EPUBs), the interface shall elegantly fallback to displaying "Section \[Index\]" or solely the chapter number.

### **4.4 Layout Hygiene & Legacy Retirement**

*   **Footer Removal:** The legacy footer within `ReaderView` (containing page navigation and progress bars) is deprecated and shall be removed. The Compass Interface supersedes this functionality.
*   **Safe Area Padding:** The text rendering container in `ReaderView` must implement sufficient bottom padding (e.g., `pb-32`) to ensure that the final lines of text are not obscured by the floating Compass Pill.

## **5\. Schematic Visualization**

The following diagram illustrates the spatial relationship between the content layer, the Compass Pill, and the Satellite FAB.
```
       (Viewport Area - Library Grid/List)
             .
             .
             .
             .
             .           [  SATELLITE FAB  ]  <-- Z-50
             .           [      ( > )      ]      (Primary Color, Opaque)
             .                                    (Shadow-XL)
             .
   +---------------------------------------+
   |  [<<]   CHAPTER 5: ADVICE...   [>>]   |  <-- Z-40
   |         -12:30 remaining              |      (Glassmorphism / Blur)
   +---------------------------------------+      (Inset 16px, Bottom 24px)

       (Device Bezel / Safe Area)
```
## **6\. Implementation Phasing Plan**

1. **Phase 1: Structural Scaffolding:** Creation of the FloatingControlsContainer.tsx within App.tsx to serve as the mounting point for both elements. This container must be transparent and pointer-event-agnostic (pointer-events-none), allowing clicks to pass through to the underlying content in empty areas.  
2. **Phase 2: The Compass Pill:** Implementation of CompassPill.tsx utilizing Flexbox layout. Implementation of the backdrop-filter CSS properties and the ambient progress bar logic.  
3. **Phase 3: The Satellite FAB:** Implementation of SatellitePlayButton.tsx with absolute positioning logic. Integration of the Play/Pause/Stop state machine.  
4. **Phase 4: Logic Integration:** Wiring of the useTTSStore actions (prevChapter, nextChapter, seek) to the component triggers. Implementation of the GestureResponder for the scrubbing functionality.  
5. **Phase 5: Validation:** Verification of the layout using the standard test fixture (*Alice's Adventures in Wonderland*) to ensure "Chapter 5: Advice from a Caterpillar" renders correctly without text overflow.
